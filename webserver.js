const uWS = require('uWebSockets.js');
const serveStatic = require('serve-static');
const finalhandler = require('finalhandler');

function dummyFunc(){}
function dummyArrFunc(){return [];}

function setHeader(k,v){
  this.headers[k] = v;
  this.writeHeader(k,v.toString());
}

function getHeader(k){
  return this.headers[k];
}

function onAborted(){
  console.log('onAborted', this);
  this.finished = true;
}

function wrapReq(req, res){
  req.method = req.getMethod().toUpperCase();
  req.url = req.getUrl();
  req.resume = dummyFunc;
  req.listeners = dummyArrFunc;
  req.headers = {
    range : req.getHeader('range'),
  }

  res.headers = {};
  res.finished = false;

  res.on = dummyFunc;
  res.once = dummyFunc;
  res.emit = dummyFunc;
  res.setHeader = setHeader;
  res.getHeader = getHeader;

  res.onAborted(onAborted.bind(res));
}

function create(host, port, publicPath, defaultIndex){
  var server = uWS.App();
  var httpHandler = serveStatic(publicPath, {index: [defaultIndex]});

  server.any('/*', function(res, req){
    wrapReq(req, res);
    httpHandler(req, res, finalhandler(req, res))
  });

  server.listen(host, port, function(success){
    console.log(success ? 'Listening to port' : 'Failed to listen on port', port);
  });
  return server;
}

function regWSS(server, name, path, onMsg, onOpen, onClose){
  server.ws(path, {
    idleTimeout: 9999999,
    upgrade: (res, req, context) => {
      res.upgrade({qs: req.getQuery()},
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context
      );
    },
    open: (ws)=>{
      if(onOpen){
        onOpen(ws);
        return;
      }
      ws.subscribe(name);
      console.log(name, 'on connect');
    },
    message: (ws, message, isBinary)=>{
      onMsg(ws, Buffer.from(message));
    },
    close: (ws)=>{
      if(onClose) onClose(ws);
    }
  });
}

module.exports = {create,regWSS};
