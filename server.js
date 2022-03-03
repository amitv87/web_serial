const usb = require('usb');
const serialport = require('serialport');
const querystring = require('querystring');
const webserver = require('./webserver.js')

const HTTP_PORT = 3032;
const HTTP_HOST = '127.0.0.1';

const kMgrWSName = 'mgr';
const kDevWSName = 'dev';

const kusbWShost = '/usbSerial';
const kttyWShost = '/ttySerial';

const devicesInUse = {};

function getStringDescriptor(dev, index){
  return new Promise((resolve, reject) => dev.getStringDescriptor(index, (e,d) => resolve(e ? undefined : (d == "Љ" ? undefined : d.trim()))));
}

function getKey(dev){
  return JSON.stringify(dev.portNumbers);
}

function openUsb(dev){
  var key = getKey(dev);
  var count = devicesInUse[key];
  if(!count){
    count = 0;
    dev.open(true);
  }
  devicesInUse[key] = count + 1;
}

function closeUsb(dev){
  var key = getKey(dev);
  var count = devicesInUse[key];
  if(!count) return;
  if(count == 1){
    try{
      dev.close();
    }
    catch(e){
      console.log('closeUsb err', e);
    }
  }
  devicesInUse[key] = count - 1;
}

const MGR_ACTION = {
  scanTTYprt: (ws, req)=>{
    serialport.list().then(function(devices){
      sendMgrRes(ws, req, devices);
    });
  },
  scanUSBPrt: async(ws, req)=>{
    var devices = [];
    var devs = usb.getDeviceList();
    for(var dev of devs){
      openUsb(dev);

      if(dev.deviceDescriptor.bDeviceClass == 0x09) continue;

      dev.prod = await getStringDescriptor(dev, dev.deviceDescriptor.iProduct);
      dev.manu = await getStringDescriptor(dev, dev.deviceDescriptor.iManufacturer);
      dev.srno = await getStringDescriptor(dev, dev.deviceDescriptor.iSerialNumber);

      if(dev.configDescriptor){
        var interfaces = [];
        for(var ifaces of dev.configDescriptor.interfaces){
          for(var iface of ifaces){
            interfaces.push({name: await getStringDescriptor(dev, iface.iInterface), ...iface});
          }
        }
        devices.push({...dev, interfaces});
      }

      closeUsb(dev);
    }
    sendMgrRes(ws, req, devices);
  },
}

function arrayEquals(a, b) {
  return Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((val, index) => val === b[index]);
}

function startTTYSerial(ws, devInfo){
  if(!devInfo || !devInfo.device) return;
  var portOptions = {
    stopBits: 1,
    dataBits: 8,
    parity: 'none',
    baudRate: 115200,
  };

  if(devInfo.baudRate > 0) portOptions.baudRate = devInfo.baudRate;

  var dev = new serialport(devInfo.device, portOptions);
  dev.on('data',  e => sendToWS(ws, e, true));
  dev.on('open',  e => console.log('serial device OnOpen', devInfo));
  dev.on('close', e => {
    console.log('serial device OnClose', devInfo);
    delete ws.dev;
    if(ws.isAlive) ws.close();
  });
  dev.on('error', e => {
    console.log('serial device OnErr', e);
    delete ws.dev;
    if(ws.isAlive) ws.close();
  });

  ws.dev = dev;
  ws.devInfo = devInfo;
}

function startUSBSerial(ws, dev, devInfo){
  ws.devInfo = devInfo;

  openUsb(dev);

  var iface = dev.interfaces[devInfo.ifaceNo];
  try{
    iface.claim();
  }
  catch(e){
    closeUsb(dev);
    console.log('usb serial device OnErr', e);
    if(ws.isAlive) ws.close();
    return;
  }

  ws.dev = dev;
  ws.iface = iface;

  ws.txEp = iface.endpoint(Number(devInfo.txEp));
  ws.txEp.on('error', e =>{
    console.log('usbSerial OnErr', e);
    closeUsb(dev);
    delete ws.dev;
    if(ws.isAlive) ws.close();
  });

  ws.rxEp = iface.endpoint(Number(devInfo.rxEp));
  ws.rxEp.on('error', e =>{
    console.log('usbSerial OnErr', e);
    closeUsb(dev);
    delete ws.dev;
    if(ws.isAlive) ws.close();
  });
  ws.rxEp.on('data', (data) => sendToWS(ws, data, true));
  ws.rxEp.startPoll();
}

function sendMgrRes(ws, req, data){
  sendToWS(ws, JSON.stringify({a: req.a + 'Res', d: data}));
}

function sendToWS(ws, data, binary){
  try{
    ws.send(data, binary);
  }
  catch(e){
    console.log('sendToWS err', e);
  }
}

const server = webserver.create(HTTP_HOST, HTTP_PORT, __dirname + '/static', 'serial.html')

webserver.regWSS(server, kMgrWSName, '/manager', function(ws, msg){
  try{
    var req = JSON.parse(msg.toString());
    console.log('mgr on data', req);
    MGR_ACTION[req.a](ws, req);
  }
  catch(e){
    console.log('mgr on msg error', e, msg);
  }
}, function(ws){
  console.log('mgr on open');
}, function(ws){
  console.log('mgr on close');
});

webserver.regWSS(server, kDevWSName, kusbWShost, function(ws, msg){
  try{
    if(ws.rxEp) ws.txEp.transfer(msg);
  }
  catch(e){
    console.log(kusbWShost, 'on msg error', e, msg);
  }
}, function(ws){
  ws.isAlive = true;
  var qsMap = querystring.decode(ws.qs);
  var devInfo = JSON.parse(qsMap.devInfo);
  console.log(kusbWShost, 'on open', qsMap.devInfo);

  var devs = usb.findByIds(devInfo.vid, devInfo.pid);

  var foundDev;
  if(devs instanceof Array){
    for(var dev of devs){
      if(dev.portNumbers && arrayEquals(devInfo.portNumbers, dev.portNumbers)){
        foundDev = dev;
        break;
      }
    }
  }
  else foundDev = devs;

  // console.log('foundDev', foundDev);

  if(!foundDev){
    ws.close();
    return;
  }

  startUSBSerial(ws, foundDev, devInfo);
}, function(ws){
  ws.isAlive = false;
  console.log(kusbWShost, 'on close', JSON.stringify(ws.devInfo));
  if(ws.iface){
    ws.iface.release(true, ()=>{
      delete ws.iface;
      if(ws.dev) closeUsb(ws.dev);
      delete ws.dev;
    });
  }
  else {
    if(ws.dev) closeUsb(ws.dev);
    delete ws.dev;
  }
});

webserver.regWSS(server, kDevWSName, kttyWShost, function(ws, msg){
  try{
    if(ws.dev) ws.dev.write(msg.toString());
  }
  catch(e){
    console.log(kttyWShost, 'on msg error', e, msg);
  }
}, function(ws){
  ws.isAlive = true;
  var qsMap = querystring.decode(ws.qs);
  var devInfo = JSON.parse(qsMap.devInfo);
  console.log(kttyWShost, 'on open', devInfo.device);
  startTTYSerial(ws, devInfo);
}, function(ws){
  ws.isAlive = false;
  console.log(kttyWShost, 'on close', ws.devInfo.device);
  if(ws.dev) ws.dev.close();
  delete ws.dev;
});
