/* global PanelElement */
'use strict';

(function(exports) {
  // The .sjs file is located in the Gecko since it needs chrome privilege.
  var AJAX_URL = 'client.sjs';

  // The client will send the currently-inputed string to server automatically
  // whenever a user stops typing for the specified period.
  var INPUT_STRING_SYNC_PERIOD = 200; // in milliseconds

  var enabled = false;
  var inputStringSyncTimer = null;
  var aesKey = null;

  function ab2str(buf) {
    return String.fromCharCode.apply(null, new Uint16Array(buf));
  }

  function str2ab(str) {
    var buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
    var bufView = new Uint16Array(buf);
    for (var i=0, strLen=str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
    }
    return buf;
  }

function base64ArrayBuffer(arrayBuffer) {
  var base64    = ''
  var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

  var bytes         = new Uint8Array(arrayBuffer)
  var byteLength    = bytes.byteLength
  var byteRemainder = byteLength % 3
  var mainLength    = byteLength - byteRemainder

  var a, b, c, d
  var chunk

  // Main loop deals with bytes in chunks of 3
  for (var i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18 // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048)   >> 12 // 258048   = (2^6 - 1) << 12
    c = (chunk & 4032)     >>  6 // 4032     = (2^6 - 1) << 6
    d = chunk & 63               // 63       = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d]
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder == 1) {
    chunk = bytes[mainLength]

    a = (chunk & 252) >> 2 // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3)   << 4 // 3   = 2^2 - 1

    base64 += encodings[a] + encodings[b] + '=='
  } else if (byteRemainder == 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1]

    a = (chunk & 64512) >> 10 // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008)  >>  4 // 1008  = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15)    <<  2 // 15    = 2^4 - 1

    base64 += encodings[a] + encodings[b] + encodings[c] + '='
  }
  
  return base64
}

  function sendMessage(type, detail) {
    if (!enabled) {
      return;
    }

    var data = {
      type: type,
      detail: (typeof detail === 'object') ? detail : detail.toString()
    };

    var miv = new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12]);
    window.crypto.subtle.encrypt(
      {
          name: "AES-GCM",
          //iv: window.crypto.getRandomValues(new Uint8Array(12)),
          iv: miv,
      },
      aesKey, //from generateKey or importKey above
      str2ab(JSON.stringify(data)) //ArrayBuffer of data you want to encrypt
    ).then(function(encrypted) {
      //returns an ArrayBuffer containing the encrypted data
      console.log(new Uint8Array(encrypted));



      console.log(base64ArrayBuffer(encrypted).length);

      exports.sendMessage(AJAX_URL, {
        message: base64ArrayBuffer(encrypted)//JSON.stringify(data)
      }, function onsuccess(data) {
        if (!data || !data.verified) {
          enabled = false;
          document.l10n.formatValue('session-expired').then(function(value) {
            alert(value);
            window.location.reload();
          });
        }
      });

    }).catch(function(err) {
      console.error(err);
    });

    
  }

  function inputStringSyncHandler() {
    if (inputStringSyncTimer) {
      clearTimeout(inputStringSyncTimer);
    }
    inputStringSyncTimer = setTimeout(function() {
      inputStringSyncTimer = null;
      sendMessage('textinput', {
        clear: true,
        string: document.getElementById('input-string').value
      });
    }, INPUT_STRING_SYNC_PERIOD);
  }

  function sendFinalInputString() {
    if (inputStringSyncTimer) {
      clearTimeout(inputStringSyncTimer);
      inputStringSyncTimer = null;
    }
    var input = document.getElementById('input-string');
    sendMessage('textinput', {
      clear: true,
      string: input.value,
      keycode: 13
    });
    input.value = '';
  }

  function init() {
    var input = document.getElementById('input-string');
    var btnSend = document.getElementById('send-string');

    input.value = '';
    input.addEventListener('keydown', function(evt) {
      switch(evt.keyCode) {
        case 13: //Enter
          setTimeout(function() {
            document.activeElement.blur();
            sendFinalInputString();
          });
          break;
        case 27: //Escape
          input.value = '';

          // Workaround Firefox's bug
          input.blur();
          input.focus();
          break;
        default:
          return;
      }
      evt.preventDefault();
    });

    input.addEventListener('focus', function() {
      // The "select()" doesn't work if it's triggered in a "focus" handler.
      setTimeout(function() {
        input.select();
      });
    });

    input.addEventListener('input', inputStringSyncHandler);
    input.addEventListener('keyup', inputStringSyncHandler);

    btnSend.addEventListener('click', sendFinalInputString);

    /* jshint nonew: false */
    new PanelElement(document.getElementById('touch-panel'), {
      touchingClass: 'touching',
      dblClickTimeThreshold: 0,
      handler: sendMessage
    });

    /* jshint nonew: false */
    new PanelElement(document.getElementById('scroll-panel'), {
      touchingClass: 'touching',
      dblClickTimeThreshold: 0,
      clickTimeThreshold: 0,
      clickMoveThreshold: 0,
      handler: function(type, detail) {
        if (detail.dx !== undefined) {
          detail.dx = 0;
        }
        sendMessage(type.replace('touch', 'scroll'), detail);
      }
    });

    var buttonOnClick = function() {
      var key = this.dataset.key;
      if (key) {
        sendMessage('keypress', key);
      }
    };

    var buttons = document.querySelectorAll('#section-buttons .button');
    [].slice.call(buttons).forEach(function(elem) {
      elem.addEventListener('click', buttonOnClick);
    });

    enabled = true;


    window.crypto.subtle.importKey(
      "jwk", //can be "jwk" or "raw"
      {   //this is an example jwk key, "raw" would be an ArrayBuffer
          kty: "oct",
          k: "Y0zt37HgOx-BY7SQjYVmrqhPkO44Ii2Jcb9yydUDPfE",
          alg: "A256GCM",
          ext: true,
      },
      {   //this is the algorithm options
          name: "AES-GCM",
      },
      false, //whether the key is extractable (i.e. can be used in exportKey)
      ["encrypt", "decrypt"] //can "encrypt", "decrypt", "wrapKey", or "unwrapKey"
    ).then(function(key) {
      //returns the symmetric key
      console.log(key);
      aesKey = key;
    }).catch(function(err) {
      console.error(err);
    });
  }

  exports.ready(init);
}(window));
