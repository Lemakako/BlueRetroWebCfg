// Base on https://www.html5rocks.com/en/tutorials/file/dndfiles//

import { brUuid, mtu, ota_start, ota_abort, ota_end } from './utils/constants.js';
import { getLatestRelease } from './utils/getLatestRelease.js';
import { getAppVersion } from './utils/getAppVersion.js';
import { getBdAddr } from './utils/getBdAddr.js';

var bluetoothDevice;
let brService = null;
var reader;
var progress = document.querySelector('.percent');
var start;
var end;
var cancel = 0;
var bdaddr;
var app_ver;
var latest_ver;
var name;
var cur_fw_hw2 = 0;

export function abortFwUpdate() {
    cancel = 1;
}

function errorHandler(evt) {
    switch(evt.target.error.code) {
        case evt.target.error.NOT_FOUND_ERR:
            log('File Not Found!');
            break;
        case evt.target.error.NOT_READABLE_ERR:
            log('File is not readable');
            break;
        case evt.target.error.ABORT_ERR:
            break; // noop
        default:
            log('An error occurred reading this file.');
    };
}

function updateProgress(total, loaded) {
    var percentLoaded = Math.round((loaded / total) * 100);
    // Increase the progress bar length.
    if (percentLoaded < 100) {
        progress.style.width = percentLoaded + '%';
        progress.textContent = percentLoaded + '%';
    }
}

export function firmwareUpdate(evt) {
    // Reset progress indicator on new file selection.
    progress.style.width = '0%';
    progress.textContent = '0%';

    reader = new FileReader();
    reader.onerror = errorHandler;
    reader.onabort = function(e) {
        log('File read cancelled');
    };
    reader.onload = function(e) {
        var decoder = new TextDecoder("utf-8");
        var header = decoder.decode(reader.result.slice(0, 256));
        var new_fw_hw2 = 1;

        if (header.indexOf('hw2') == -1) {
            new_fw_hw2 = 0
        }

        if (cur_fw_hw2 == new_fw_hw2) {
            writeFirmware(reader.result, 0);
        }
        else {
            log("Hardware and firmware mismatch!");
        }
    }

    // Read in the image file as a binary string.
    reader.readAsArrayBuffer(document.getElementById("fwFile").files[0]);
}

function writeFwRecursive(chrc, data, offset) {
    return new Promise(function(resolve, reject) {
        if (cancel == 1) {
            throw 'Cancelled';
        }
        updateProgress(data.byteLength, offset);
        var tmpViewSize = data.byteLength - offset;
        if (tmpViewSize > mtu) {
            tmpViewSize = mtu;
        }
        var tmpView = new DataView(data, offset, tmpViewSize);
        chrc.writeValue(tmpView)
        .then(_ => {
            offset += Number(mtu);
            if (offset < data.byteLength) {
                resolve(writeFwRecursive(chrc, data, offset));
            }
            else {
                end = performance.now();
                progress.style.width = '100%';
                progress.textContent = '100%';
                log('FW upload done. Took: '  + (end - start)/1000 + ' sec');
                resolve();
            }
        })
        .catch(error => {
            reject(error);
        });
    });
}

function writeFirmware(data) {
    var cmd = new Uint8Array(1);
    let ctrl_chrc = null;
    document.getElementById('progress_bar').className = 'loading';
    document.getElementById("divBtConn").style.display = 'none';
        document.getElementById("divInfo").style.display = 'block';
    document.getElementById("divFwSelect").style.display = 'none';
    document.getElementById("divFwUpdate").style.display = 'block';
    brService.getCharacteristic(brUuid[7])
    .then(chrc => {
        ctrl_chrc = chrc;
        cmd[0] = ota_start;
        return ctrl_chrc.writeValue(cmd)
    })
    .then(_ => {
        return brService.getCharacteristic(brUuid[8])
    })
    .then(chrc => {
        start = performance.now();
        return writeFwRecursive(chrc, data, 0);
    })
    .then(_ => {
        cmd[0] = ota_end;
        return ctrl_chrc.writeValue(cmd)
    })
    .catch(error => {
        log('Argh! ' + error);
        document.getElementById("divBtConn").style.display = 'none';
        document.getElementById("divInfo").style.display = 'block';
        document.getElementById("divFwSelect").style.display = 'block';
        document.getElementById("divFwUpdate").style.display = 'none';
        cancel = 0;
        cmd[0] = ota_abort;
        return ctrl_chrc.writeValue(cmd)
    });
}

function onDisconnected() {
    log('> Bluetooth Device disconnected');
    cancel = 0;
    document.getElementById("divBtConn").style.display = 'block';
    document.getElementById("divInfo").style.display = 'none';
    document.getElementById("divFwSelect").style.display = 'none';
    document.getElementById("divFwUpdate").style.display = 'none';
}

export function btConn() {
    log('Requesting Bluetooth Device...');
    navigator.bluetooth.requestDevice(
        {filters: [{namePrefix: 'BlueRetro'}],
        optionalServices: [brUuid[0]]})
    .then(device => {
        log('Connecting to GATT Server...');
        name = device.name;
        bluetoothDevice = device;
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        return bluetoothDevice.gatt.connect();
    })
    .then(server => {
        log('Getting BlueRetro Service...');
        return server.getPrimaryService(brUuid[0]);
    })
    .then(service => {
        brService = service;
        return getBdAddr(brService);
    })
    .then(value => {
        bdaddr = value;
        return getLatestRelease();
    })
    .then(value => {
        latest_ver = value;
        return getAppVersion(brService);
    })
    .then(value => {
        app_ver = value;
        document.getElementById("divInfo").innerHTML = 'Connected to: ' + name + ' (' + bdaddr + ') [' + app_ver + ']';
        if (app_ver.indexOf(latest_ver) == -1) {
            document.getElementById("divInfo").innerHTML += '<br><br>Download latest FW ' + latest_ver + ' from <a href=\'https://darthcloud.itch.io/blueretro\'>itch.io</a>';
        }
        if (app_ver.indexOf('hw2') != -1) {
            cur_fw_hw2 = 1;
        }
        log('Init Cfg DOM...');
        document.getElementById("divBtConn").style.display = 'none';
        document.getElementById("divInfo").style.display = 'block';
        document.getElementById("divFwSelect").style.display = 'block';
        document.getElementById("divFwUpdate").style.display = 'none';
    })
    .catch(error => {
        log('Argh! ' + error);
    });
}
