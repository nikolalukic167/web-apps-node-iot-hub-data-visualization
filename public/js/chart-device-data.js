/* eslint-disable max-classes-per-file */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */
$(document).ready(() => {
  const protocol = document.location.protocol.startsWith('https') ? 'wss://' : 'ws://';
  const webSocket = new WebSocket(protocol + location.host);

  const NOMINAL_BANNER_STYLE = {
    background: '#dcfce7',
    borderColor: '#86efac',
    color: '#14532d',
  };
  const ALERT_BANNER_STYLE = {
    background: '#ea580c',
    borderColor: '#9a3412',
    color: '#fff',
  };

  class DeviceData {
    constructor(deviceId) {
      this.deviceId = deviceId;
      this.maxLen = 50;
      this.timeData = new Array(this.maxLen);
      this.powerData = new Array(this.maxLen);
      this.noiseData = new Array(this.maxLen);
    }

    addData(time, powerW, noiseDb) {
      this.timeData.push(time);
      this.powerData.push(powerW);
      this.noiseData.push(noiseDb);

      if (this.timeData.length > this.maxLen) {
        this.timeData.shift();
        this.powerData.shift();
        this.noiseData.shift();
      }
    }
  }

  class TrackedDevices {
    constructor() {
      this.devices = [];
    }

    findDevice(deviceId) {
      for (let i = 0; i < this.devices.length; ++i) {
        if (this.devices[i].deviceId === deviceId) {
          return this.devices[i];
        }
      }

      return undefined;
    }

    getDevicesCount() {
      return this.devices.length;
    }
  }

  const trackedDevices = new TrackedDevices();

  const chartData = {
    datasets: [
      {
        fill: false,
        label: 'Power Consumption (W)',
        yAxisID: 'Power',
        borderColor: 'rgba(234, 88, 12, 1)',
        pointBoarderColor: 'rgba(234, 88, 12, 1)',
        backgroundColor: 'rgba(234, 88, 12, 0.35)',
        pointHoverBackgroundColor: 'rgba(234, 88, 12, 1)',
        pointHoverBorderColor: 'rgba(234, 88, 12, 1)',
        spanGaps: true,
      },
      {
        fill: false,
        label: 'Acoustic Noise (dB)',
        yAxisID: 'Noise',
        borderColor: 'rgba(37, 99, 235, 1)',
        pointBoarderColor: 'rgba(37, 99, 235, 1)',
        backgroundColor: 'rgba(37, 99, 235, 0.35)',
        pointHoverBackgroundColor: 'rgba(37, 99, 235, 1)',
        pointHoverBorderColor: 'rgba(37, 99, 235, 1)',
        spanGaps: true,
      },
    ],
  };

  const chartOptions = {
    scales: {
      yAxes: [
        {
          id: 'Power',
          type: 'linear',
          position: 'left',
          scaleLabel: {
            labelString: 'Power (W) — typical 0–500',
            display: true,
          },
          ticks: {
            min: 0,
            max: 520,
            stepSize: 50,
          },
          gridLines: {
            color: 'rgba(0,0,0,0.06)',
          },
        },
        {
          id: 'Noise',
          type: 'linear',
          position: 'right',
          scaleLabel: {
            labelString: 'Noise (dB) — typical 30–100',
            display: true,
          },
          ticks: {
            min: 25,
            max: 105,
            stepSize: 10,
          },
          gridLines: {
            drawOnChartArea: false,
          },
        },
      ],
    },
  };

  const ctx = document.getElementById('iotChart').getContext('2d');
  const myLineChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: chartOptions,
  });

  let needsAutoSelect = true;
  const deviceCount = document.getElementById('deviceCount');
  const listOfDevices = document.getElementById('listOfDevices');
  const edgeInferenceBanner = document.getElementById('edgeInferenceBanner');
  const machineStateDisplay = document.getElementById('machineStateDisplay');

  function applyInferenceBannerStyle(isAnomaly) {
    if (!edgeInferenceBanner) return;
    const s = isAnomaly ? ALERT_BANNER_STYLE : NOMINAL_BANNER_STYLE;
    edgeInferenceBanner.style.background = s.background;
    edgeInferenceBanner.style.borderColor = s.borderColor;
    edgeInferenceBanner.style.color = s.color;
    if (machineStateDisplay) {
      machineStateDisplay.style.color = s.color;
    }
  }

  function updateMachineStateUi(messageData) {
    if (!machineStateDisplay) return;
    const state =
      messageData.MachineState != null && String(messageData.MachineState).trim().length
        ? String(messageData.MachineState)
        : 'Unknown';
    machineStateDisplay.innerHTML = state;

    const edgeAlert =
      messageData.EdgeAlert === true ||
      messageData.EdgeAlert === 'true' ||
      (typeof messageData.EdgeAlert === 'string' &&
        messageData.EdgeAlert.toLowerCase() === 'true');
    const anomalyInText = state.toUpperCase().includes('ANOMALY');
    const isAnomaly = edgeAlert || anomalyInText;

    applyInferenceBannerStyle(isAnomaly);
  }

  function OnSelectionChange() {
    const device = trackedDevices.findDevice(listOfDevices[listOfDevices.selectedIndex].text);
    chartData.labels = device.timeData;
    chartData.datasets[0].data = device.powerData;
    chartData.datasets[1].data = device.noiseData;
    myLineChart.update();
  }
  listOfDevices.addEventListener('change', OnSelectionChange, false);

  webSocket.onmessage = function onMessage(message) {
    try {
      const messageData = JSON.parse(message.data);
      console.log(messageData);

      const hasPower = messageData.powerConsumption != null && !Number.isNaN(Number(messageData.powerConsumption));
      const hasNoise = messageData.acousticNoise != null && !Number.isNaN(Number(messageData.acousticNoise));
      if (!messageData.deviceId || !messageData.messageDate || (!hasPower && !hasNoise)) {
        return;
      }

      updateMachineStateUi(messageData);

      const powerVal = hasPower ? Number(messageData.powerConsumption) : null;
      const noiseVal = hasNoise ? Number(messageData.acousticNoise) : null;

      const existingDeviceData = trackedDevices.findDevice(messageData.deviceId);

      if (existingDeviceData) {
        existingDeviceData.addData(messageData.messageDate, powerVal, noiseVal);
      } else {
        const newDeviceData = new DeviceData(messageData.deviceId);
        trackedDevices.devices.push(newDeviceData);
        const numDevices = trackedDevices.getDevicesCount();
        deviceCount.innerText = numDevices === 1 ? `${numDevices} device` : `${numDevices} devices`;
        newDeviceData.addData(messageData.messageDate, powerVal, noiseVal);

        const node = document.createElement('option');
        const nodeText = document.createTextNode(messageData.deviceId);
        node.appendChild(nodeText);
        listOfDevices.appendChild(node);

        if (needsAutoSelect) {
          needsAutoSelect = false;
          listOfDevices.selectedIndex = 0;
          OnSelectionChange();
        }
      }

      myLineChart.update();
    } catch (err) {
      console.error(err);
    }
  };
});
