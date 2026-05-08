const WebSocket = require('ws');

// Connect to the new modal page
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/AFA0527195A1FEE2A6E642EDA8D3DBCD');

ws.on('open', function open() {
  console.log('Connected to modal, checking content...');
  
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { 
      expression: `document.title + ' | ' + document.body.innerText.substring(0, 500)`
    }
  }));
});

ws.on('message', function incoming(data) {
  const msg = JSON.parse(data);
  if (msg.result && msg.result.result && msg.result.result.value) {
    console.log('Result:', msg.result.result.value);
  }
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 5000);