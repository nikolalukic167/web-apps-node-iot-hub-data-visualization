/* eslint-disable max-classes-per-file */
/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */
$(document).ready(() => {
  const protocol = document.location.protocol.startsWith('https') ? 'wss://' : 'ws://';
  const webSocket = new WebSocket(protocol + location.host);

  const SPINDLE_SENSOR_ID = 'edge-spindle-temp-04';
  const EDGE_ALERT_VISIBLE_MS = 10000;

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

  let edgeAlertHideTimeout;

  function isEdgeAlertMessage(messageData) {
    return (
      messageData.EdgeAlert === true ||
      messageData.EdgeAlert === 'true' ||
      (typeof messageData.EdgeAlert === 'string' &&
        messageData.EdgeAlert.toLowerCase() === 'true')
    );
  }

  function showEdgeAlertBanner(machineStateText) {
    const banner = document.getElementById('edgeAlertBanner');
    const stateEl = document.getElementById('edgeAlertMachineState');
    if (!banner || !stateEl) return;
    stateEl.textContent = machineStateText && String(machineStateText).trim().length
      ? String(machineStateText)
      : 'Unknown alert condition';
    banner.hidden = false;
    clearTimeout(edgeAlertHideTimeout);
    edgeAlertHideTimeout = setTimeout(() => {
      banner.hidden = true;
    }, EDGE_ALERT_VISIBLE_MS);
  }

  class DeviceData {
    constructor(deviceId) {
      this.deviceId = deviceId;
      this.maxLen = 50;
      this.timeData = new Array(this.maxLen);
      this.powerData = new Array(this.maxLen);
      this.noiseData = new Array(this.maxLen);
      this.spindleTimeData = new Array(this.maxLen);
      this.spindleTempData = new Array(this.maxLen);
    }

    addPowerNoise(time, powerW, noiseDb) {
      this.timeData.push(time);
      this.powerData.push(powerW);
      this.noiseData.push(noiseDb);

      if (this.timeData.length > this.maxLen) {
        this.timeData.shift();
        this.powerData.shift();
        this.noiseData.shift();
      }
    }

    addSpindleSample(time, tempC) {
      this.spindleTimeData.push(time);
      this.spindleTempData.push(tempC);

      if (this.spindleTimeData.length > this.maxLen) {
        this.spindleTimeData.shift();
        this.spindleTempData.shift();
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

  function lineDataset(label, borderRgb, fillRgb) {
    return {
      fill: false,
      label,
      borderColor: borderRgb,
      pointBoarderColor: borderRgb,
      backgroundColor: fillRgb,
      pointHoverBackgroundColor: borderRgb,
      pointHoverBorderColor: borderRgb,
      spanGaps: true,
    };
  }

  const powerChart = new Chart(document.getElementById('powerChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        Object.assign(
          lineDataset(
            'Power consumption (W)',
            'rgba(234, 88, 12, 1)',
            'rgba(234, 88, 12, 0.35)',
          ),
          { data: [] },
        ),
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        xAxes: [{ display: true }],
        yAxes: [
          {
            scaleLabel: {
              display: true,
              labelString: 'Power (W)',
            },
            ticks: {
              min: 0,
              max: 520,
              stepSize: 50,
            },
            gridLines: { color: 'rgba(0,0,0,0.06)' },
          },
        ],
      },
    },
  });

  const noiseChart = new Chart(document.getElementById('noiseChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        Object.assign(
          lineDataset(
            'Acoustic noise (dB)',
            'rgba(37, 99, 235, 1)',
            'rgba(37, 99, 235, 0.35)',
          ),
          { data: [] },
        ),
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        xAxes: [{ display: true }],
        yAxes: [
          {
            scaleLabel: {
              display: true,
              labelString: 'Noise (dB)',
            },
            ticks: {
              min: 25,
              max: 105,
              stepSize: 10,
            },
            gridLines: { color: 'rgba(0,0,0,0.06)' },
          },
        ],
      },
    },
  });

  const spindleChart = new Chart(document.getElementById('spindleTempChart').getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        Object.assign(
          lineDataset(
            'Spindle temperature (°C)',
            'rgba(185, 28, 28, 1)',
            'rgba(185, 28, 28, 0.35)',
          ),
          { data: [] },
        ),
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        xAxes: [{ display: true }],
        yAxes: [
          {
            scaleLabel: {
              display: true,
              labelString: 'Temperature (°C)',
            },
            ticks: {
              min: 0,
              max: 150,
              stepSize: 10,
            },
            gridLines: { color: 'rgba(0,0,0,0.06)' },
          },
        ],
      },
    },
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

    const edgeAlert = isEdgeAlertMessage(messageData);
    const anomalyInText = state.toUpperCase().includes('ANOMALY');
    const isAnomaly = edgeAlert || anomalyInText;

    applyInferenceBannerStyle(isAnomaly);

    if (edgeAlert) {
      showEdgeAlertBanner(state);
    }
  }

  function syncChartsFromDevice(device) {
    powerChart.data.labels = device.timeData;
    noiseChart.data.labels = device.timeData;
    powerChart.data.datasets[0].data = device.powerData;
    noiseChart.data.datasets[0].data = device.noiseData;
    spindleChart.data.labels = device.spindleTimeData;
    spindleChart.data.datasets[0].data = device.spindleTempData;
    powerChart.update();
    noiseChart.update();
    spindleChart.update();
  }

  function OnSelectionChange() {
    const device = trackedDevices.findDevice(listOfDevices[listOfDevices.selectedIndex].text);
    if (!device) return;
    syncChartsFromDevice(device);
  }
  listOfDevices.addEventListener('change', OnSelectionChange, false);

  webSocket.onmessage = function onMessage(message) {
    try {
      const messageData = JSON.parse(message.data);
      console.log(messageData);

      if (!messageData.deviceId || !messageData.messageDate) {
        return;
      }

      const hasPower =
        messageData.powerConsumption != null &&
        !Number.isNaN(Number(messageData.powerConsumption));
      const hasNoise =
        messageData.acousticNoise != null &&
        !Number.isNaN(Number(messageData.acousticNoise));
      const hasSpindle =
        messageData.sensorId === SPINDLE_SENSOR_ID &&
        messageData.temperature != null &&
        !Number.isNaN(Number(messageData.temperature));

      if (!hasPower && !hasNoise && !hasSpindle) {
        return;
      }

      updateMachineStateUi(messageData);

      const powerVal = hasPower ? Number(messageData.powerConsumption) : null;
      const noiseVal = hasNoise ? Number(messageData.acousticNoise) : null;

      let existingDeviceData = trackedDevices.findDevice(messageData.deviceId);

      if (existingDeviceData) {
        if (hasPower || hasNoise) {
          existingDeviceData.addPowerNoise(
            messageData.messageDate,
            powerVal,
            noiseVal,
          );
        }
        if (hasSpindle) {
          existingDeviceData.addSpindleSample(
            messageData.messageDate,
            Number(messageData.temperature),
          );
        }
      } else {
        const newDeviceData = new DeviceData(messageData.deviceId);
        trackedDevices.devices.push(newDeviceData);
        const numDevices = trackedDevices.getDevicesCount();
        deviceCount.innerText = numDevices === 1 ? `${numDevices} device` : `${numDevices} devices`;

        if (hasPower || hasNoise) {
          newDeviceData.addPowerNoise(messageData.messageDate, powerVal, noiseVal);
        }
        if (hasSpindle) {
          newDeviceData.addSpindleSample(
            messageData.messageDate,
            Number(messageData.temperature),
          );
        }

        const node = document.createElement('option');
        const nodeText = document.createTextNode(messageData.deviceId);
        node.appendChild(nodeText);
        listOfDevices.appendChild(node);

        if (needsAutoSelect) {
          needsAutoSelect = false;
          listOfDevices.selectedIndex = 0;
          OnSelectionChange();
          return;
        }
      }

      const selected = trackedDevices.findDevice(
        listOfDevices[listOfDevices.selectedIndex].text,
      );
      if (selected && selected.deviceId === messageData.deviceId) {
        syncChartsFromDevice(selected);
      }
    } catch (err) {
      console.error(err);
    }
  };
});
