const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const EventHubReader = require('./scripts/event-hub-reader.js');

const iotHubConnectionString = process.env.IotHubConnectionString;
if (!iotHubConnectionString) {
  console.error(`Environment variable IotHubConnectionString must be specified.`);
  return;
}
console.log(`Using IoT Hub connection string [${iotHubConnectionString}]`);

const eventHubConsumerGroup = process.env.EventHubConsumerGroup;
console.log(eventHubConsumerGroup);
if (!eventHubConsumerGroup) {
  console.error(`Environment variable EventHubConsumerGroup must be specified.`);
  return;
}
console.log(`Using event hub consumer group [${eventHubConsumerGroup}]`);

// Redirect requests to the public subdirectory to the root
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res /* , next */) => {
  res.redirect('/');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.broadcast = (data) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        console.log(`Broadcasting data ${data}`);
        client.send(data);
      } catch (e) {
        console.error(e);
      }
    }
  });
};

server.listen(process.env.PORT || '3000', () => {
  console.log('Listening on %d.', server.address().port);
});

const eventHubReader = new EventHubReader(iotHubConnectionString, eventHubConsumerGroup);

function parseTelemetryBody(body) {
  if (body == null) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString());
    } catch {
      return null;
    }
  }
  return typeof body === 'object' ? body : null;
}

function readProperty(properties, primaryKey, alternateKey) {
  if (!properties) return undefined;
  if (typeof properties.get === 'function') {
    return properties.get(primaryKey) ?? properties.get(alternateKey);
  }
  if (typeof properties === 'object') {
    return properties[primaryKey] ?? properties[alternateKey];
  }
  return undefined;
}

function readEdgeAlertFromProperties(properties) {
  const raw = readProperty(properties, 'EdgeAlert', 'edgeAlert');
  if (raw === true) return true;
  if (typeof raw === 'string' && raw.toLowerCase() === 'true') return true;
  return false;
}

function readMachineStateFromProperties(properties) {
  const raw = readProperty(properties, 'MachineState', 'machineState');
  if (raw == null) return 'Unknown';
  const text = String(raw).trim();
  return text.length ? text : 'Unknown';
}

(async () => {
  await eventHubReader.startReadMessage((messageBody, date, deviceId, applicationProperties) => {
    try {
      const iotData = parseTelemetryBody(messageBody);
      if (!iotData || !deviceId) {
        return;
      }

      const powerConsumption = Number(iotData.powerConsumption);
      const acousticNoise = Number(iotData.acousticNoise);
      const hasPower = !Number.isNaN(powerConsumption);
      const hasNoise = !Number.isNaN(acousticNoise);
      if (!hasPower && !hasNoise) {
        return;
      }

      const messageDate =
        date && typeof date.toISOString === 'function'
          ? date.toISOString()
          : new Date(date || Date.now()).toISOString();

      const payload = {
        deviceId,
        messageDate,
        powerConsumption: hasPower ? powerConsumption : null,
        acousticNoise: hasNoise ? acousticNoise : null,
        EdgeAlert: readEdgeAlertFromProperties(applicationProperties),
        MachineState: readMachineStateFromProperties(applicationProperties),
      };

      wss.broadcast(JSON.stringify(payload));
    } catch (err) {
      console.error('Error broadcasting: [%s] from [%s].', err, messageBody);
    }
  });
})().catch();