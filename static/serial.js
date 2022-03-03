const ttyDevices = document.getElementById('ttyDevices');
const ttyBaudRates = document.getElementById('ttyBaudRates');

const usbDevices = document.getElementById('usbDevices');
const usbDevInterfaces = document.getElementById('usbDevInterfaces');
const usbDevEndpointsRx = document.getElementById('usbDevEndpointsRx');
const usbDevEndpointsTx = document.getElementById('usbDevEndpointsTx');
const usbBaudRates = document.getElementById('usbBaudRates');

const termCont = document.getElementById('termCont');

const terminals = {};

const MGR_ACTION_REQ = {
  SCAN_TTY_PRT: 'scanTTYprt',
  SCAN_USB_PRT: 'scanUSBPrt',
}

const MGR_ACTION_RES = {
  [MGR_ACTION_REQ.SCAN_TTY_PRT]: (res)=>{
    ttyDevices.innerHTML = "";
    for(var i = 0; i < res.d.length; i++){
      var item = res.d[i].path;
      // if(item.indexOf('Bluetooth') >= 0) continue;
      var opt = document.createElement('option');
      opt.value = item;
      opt.innerHTML = item;
      opt.innerHTML = item.replace('/dev/tty.', '');
      ttyDevices.appendChild(opt);
    }
  },
  [MGR_ACTION_REQ.SCAN_USB_PRT]: (res)=>{
    usbDevices.innerHTML = "";
    for(var i = 0; i < res.d.length; i++){
      var device = res.d[i];
      var opt = document.createElement('option');
      opt.device = device;
      opt.value = i;
      opt.innerHTML = getUsbDevName(device);
      usbDevices.appendChild(opt);
    }
    loadUSBDevIfs();
  },
}

String.prototype.hashCode = function(){
  var hash = 0;
  for (var i = 0; i < this.length; i++) {
    var character = this.charCodeAt(i);
    hash = ((hash<<5)-hash)+character;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}


function stopWS(ws){
  if(!ws) return;
  ws.onerror = ws.onclose = null;
  clearTimeout(ws.retryJob);
  ws.close();
}

function startWS(url, onOpen, onMsg, onClose, ctx){
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = ()=>onOpen(ws);
  ws.onmessage = (e)=>onMsg(e.data);

  const retry = ()=>{
    ws.onerror = null;
    ws.onclose = null;
    ws.retryJob = setTimeout(()=>startWS(url, onOpen, onMsg, onClose, ctx), 1000);
    onClose();
  }

  ws.onerror = ws.onclose = retry;

  if(ctx) ctx.socket = ws;
}

function sendToWS(ws, data){
  if(ws && ws.readyState == 1) ws.send(data);
}

function getUsbDevName(device){
  return `[${device.deviceDescriptor.idVendor.toString(16)}/${device.deviceDescriptor.idProduct.toString(16)}]${device.manu} ${device.prod} ${device.srno ? `(${device.srno})` : ''}`;
}

function getUsbDevIfName(idx, iface){
  return '(' + idx + ') ' + (iface.name ? iface.name : 'n/a');
}

function loadUSBDevIfs(){
  usbDevInterfaces.innerHTML = "";
  usbDevEndpointsRx.innerHTML = "";
  usbDevEndpointsTx.innerHTML = "";
  var option = usbDevices[usbDevices.selectedIndex];
  if(!option) return;
  var device = option.device;

  var ifaces = device.interfaces;
  console.log('loadUSBDevIfs', ifaces);
  if(!ifaces) return;

  for(var i = 0; i < ifaces.length; i++){
    var iface = ifaces[i];

    var rxepFound = false, txepFound = false;
    for(var j = 0; j < iface.endpoints.length; j++){
      var ep = iface.endpoints[j];
      if(ep.bEndpointAddress & 0x80) rxepFound = true;
      else txepFound = true;
    }

    if(!rxepFound || !txepFound) continue;

    var opt = document.createElement('option');
    opt.iface = iface;
    opt.value = i;
    opt.innerHTML = getUsbDevIfName(i, iface);
    usbDevInterfaces.appendChild(opt);
  }

  loadUSBDevIfEps();
}

function loadUSBDevIfEps(){
  usbDevEndpointsRx.innerHTML = "";
  usbDevEndpointsTx.innerHTML = "";

  var option = usbDevInterfaces[usbDevInterfaces.selectedIndex];
  if(!option) return;

  var iface = option.iface;
  // console.log('loadUSBDevIfEps', iface);

  iface.endpoints.sort(function(a, b){return a.bEndpointAddress - b.bEndpointAddress});

  for(var i = 0; i < iface.endpoints.length; i++){
    var ep = iface.endpoints[i];
    if(!ep) continue;
    var opt = document.createElement('option');
    opt.ep = ep;
    opt.value = ep.bEndpointAddress;
    opt.innerHTML = ep.bEndpointAddress.toString(16);
    if(ep.bEndpointAddress & 0x80) usbDevEndpointsRx.appendChild(opt);
    else usbDevEndpointsTx.appendChild(opt);
  }
}

function startTTY(){
  var option = ttyDevices[ttyDevices.selectedIndex];
  if(!option) return;

  var device = option.value;
  option = ttyBaudRates[ttyBaudRates.selectedIndex];
  if(!option) return;

  var baudRate = Number(option.value);

  var devInfo = {
    device,
    baudRate,
  };

  console.log('startTTY', devInfo);

  startTerm({
    devInfo,
    wsPath: '/ttySerial',
    label: device + '@' + baudRate,
  });
}

function startUSB(){
  var option = usbDevices[usbDevices.selectedIndex];
  if(!option) return;

  var device = option.device;
  option = usbDevInterfaces[usbDevInterfaces.selectedIndex];
  if(!option) return;

  var ifaceNo = option.value;
  option = usbDevEndpointsRx[usbDevEndpointsRx.selectedIndex];
  if(!option) return;

  var rxEp = option.value;
  option = usbDevEndpointsTx[usbDevEndpointsTx.selectedIndex];
  if(!option) return;

  var txEp = option.value;

  var devInfo = {
    vid: device.deviceDescriptor.idVendor,
    pid: device.deviceDescriptor.idProduct,
    ifaceNo, rxEp, txEp,
    portNumbers: device.portNumbers,
  };

  console.log('startUSB', devInfo);

  startTerm({
    devInfo,
    wsPath: '/usbSerial',
    label: getUsbDevName(device) + ' ' + getUsbDevIfName(ifaceNo, device.interfaces[ifaceNo]),
  });
}

function newElement(html){
  var template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstChild;
}

function clearTerm(name){
  var conf = terminals[name];
  if(!conf) return;
  conf.clear();
  conf.focus();
}

function closeTerm(name){
  var conf = terminals[name];
  if(!conf) return;
  conf.destroy();
  delete terminals[name];
  fitTerm();
}

function onChkEcho(el, name){
  var conf = terminals[name];
  console.log('onChkEcho', el.checked, conf);
  if(!conf) return;
  conf.echo = el.checked;
}

function startTerm(conf){
  if(!conf.devInfo) return false;
  var name = JSON.stringify(conf.devInfo).hashCode();
  if(terminals[name]) return false;

  var elid = 'term' + name;
  var statusId = 'status' + name;

  var termHeader = `
    <div style="background:#9E9E9E;padding: 0px 10px 0 10px;">
      <div style="float:left;">
        <label>${conf.label}</label>
      </div>
      <div style="float:right;">
        <label style="user-select: none;"><input type="checkbox" checked onclick='onChkEcho(this,${name});'>echo</label>
        <button onclick="clearTerm(${name})">clear</button>
        <button onclick="closeTerm(${name})">close</button>
        <label id=${statusId}>connecting...</label>
      </div>
    </div>
    <div id="${elid}" style="flex: 1;overflow: hidden;"></div>
  `;

  var container = newElement(
    '<div style="display: flex;flex-flow: column;flex:1;background:black;overflow:hidden;border: 1px solid #9E9E9E">'
    + termHeader
    + '</div>'
  );

  termCont.appendChild(container);

  var fitAddon = new FitAddon.FitAddon();
  var term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 9999999
  });

  term.loadAddon(fitAddon);
  term.open(document.getElementById(elid));
  // term.loadAddon(new WebglAddon.WebglAddon());

  if(conf.onResize) term.onResize(conf.onResize.bind(conf));

  var _conf = terminals[name] = {
    ...conf,
    echo: true,
    fitAddon,
    focus: () => term.focus(),
    clear: () => term.reset(),
    destroy: ()=>{
      term.dispose();
      container.remove();
      stopWS(term.socket);
      delete this.term;
    }
  }

  // term.write('\x1b[?25l'); // !cursorBlink
  term.onData(data => {
    data.replace(/\n?\r/g, "\r\n").match(/(.|[\r\n]){1,64}/g).forEach(chunk => {
      if(!chunk.length) return;
      if(term.socket) sendToWS(term.socket, chunk);
      if(_conf.echo) term.write(chunk);
    })
  });


  fitTerm();

  var statusEl = document.getElementById(statusId);
  var wsUrl = 'ws://' + window.location.host + conf.wsPath + '?devInfo=' + encodeURI(JSON.stringify(conf.devInfo));

  startWS(
    wsUrl,
    ws => {socket = ws; statusEl.innerHTML = 'online'},
    msg => term.write(typeof msg === 'string' ? msg : new Uint8Array(msg)),
    e => statusEl.innerHTML = 'offline',
    term,
  );

  return true;
}

function fitTerm(){
  Object.keys(terminals).forEach(name => {
    var conf = terminals[name];
    if(conf.fitAddon) conf.fitAddon.fit();
  })
}

var wsMgr;

function sendAction(action){
  console.log('sendAction', action);
  sendToMGR(action);
}

function sendToMGR(action, data){
  sendToWS(wsMgr, JSON.stringify({a:action, d:data}));
}

startWS('ws://' + window.location.host + '/manager',
  (ws)=>{
    wsMgr = ws;
    sendAction(MGR_ACTION_REQ.SCAN_TTY_PRT);
    sendAction(MGR_ACTION_REQ.SCAN_USB_PRT);
    console.log('mgr on open');
  },
  (msg)=>{
    try{
      var res = JSON.parse(msg);
      console.log('res', res);
      if(res.a.endsWith("Res")) MGR_ACTION_RES[res.a.split('Res')[0]](res);
    }
    catch(e){
      console.log('mgr on msg err', e, msg);
    }
  },
  ()=>{
    wsMgr = null;
    console.log('mgr on close');
  }
);

function delayResize(delay){
  clearTimeout(window.rjob);
  window.rjob = setTimeout(fitTerm, isFinite(delay) ? delay : 250);
}

elementResizeEvent(termCont, delayResize);
