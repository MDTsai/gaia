/* global Secure */
'use strict';

(function(exports) {
  // The .sjs file is located in the Gecko since it needs chrome privilege.
  var AJAX_URL = 'pairing.sjs';

  var POLLING_PERIOD = 1000;
  var POLLING_MAX_COUNT = 30;

  var secure;

  function init() {
    secure = new Secure();
    secure.restore().catch(function(err) {
      console.error(err);
      window.location.reload();
    });

    var btnSubmit = document.getElementById('connect');
    var btnRestartPairing = document.getElementById('restart-pairing');
    var pinCodeInput = new PinCodeInput(
      document.getElementById('input-mask'),
      [].slice.call(document.querySelectorAll('.code')),
      btnSubmit
    );

    btnRestartPairing.addEventListener('click', function() {
      window.location.reload();
    });

    btnSubmit.addEventListener('click', function(evt) {
      var pincode = pinCodeInput.getCodes();
      if (pincode === '') {
        pinCodeInput.highlightEmptyCode();
        return;
      }

      btnSubmit.disabled = true;

      var onerror = function(message) {
        pinCodeInput.empty();
        btnSubmit.disabled = false;
        showMessage(message, true);
      };

      pair(pincode).then(function() {
        document.l10n.formatValue('connect-success').then(showMessage);
        setTimeout(function() {
          // Server will help redirecting to client.html when there is a UUID in
          // cookie.
          window.location.reload();
        }, 1000);
      }).catch(function(errorMessageL10n) {
        if (typeof errorMessageL10n === 'string') {
          errorMessageL10n = {
            id: errorMessageL10n
          };
        }
        document.l10n.formatValue(errorMessageL10n.id, errorMessageL10n.args)
          .then(onerror);
      });
    });
  }

  function pair(pincode) {
    return new Promise(function(resolve, reject) {
      secure.encrypt(pincode).then(function(encryptedPIN) {
        var pairingData = {
          action: 'pair-pincode',
          encryptedPIN: encryptedPIN
        };

        exports.sendMessage(
          AJAX_URL,
          {
            message: JSON.stringify(pairingData)
          },
          function success(data) {
            if (data && data.ticket) {
              var ticket = data.ticket;
              var pollingCount = 0;
              (function pollingFunction() {
                if (++pollingCount > POLLING_MAX_COUNT) {
                  reject('Request timed out');
                  return;
                }
                exports.sendMessage(
                  AJAX_URL,
                  {
                    message: JSON.stringify({
                      action: 'poll-pair-result',
                      ticket: ticket
                    })
                  },
                  function success(data) {
                    if (data.done) {
                      if (data.verified) {
                        resolve();
                      } else if (data.reason == 'expired') {
                        document.getElementById('pairing-container')
                          .classList.add('pin-code-expired');
                        reject('pin-code-expired-message');
                      } else {
                        reject('wrong-pin');
                      }
                    } else {
                      setTimeout(pollingFunction, POLLING_PERIOD);
                    }
                  },
                  function error(status) {
                    reject({
                      id: 'connect-error',
                      args: {
                        status: String(status)
                      }
                    });
                  }
                );
              })();
            } else {
              reject('connect-error-invalid-response');
            }
          },
          function error(status) {
            reject({
              id: 'connect-error',
              args: {
                status: String(status)
              }
            });
          }
        );
      }).catch(function(err) {
        reject('connect-error-invalid-response');
      });
    });
  }

  function showMessage(message, isError) {
    var divMessage = document.getElementById('pairing-message');
    divMessage.textContent = message;
    if (isError) {
      divMessage.classList.add('error');
      divMessage.classList.remove('success');
    } else {
      divMessage.classList.add('success');
      divMessage.classList.remove('error');
    }
  }

  function PinCodeInput(mask, codes, submitButton) {
    var self = this;

    self._mask = mask;
    self._codes = codes;
    self._submitButton = submitButton;
    self._index = -1;

    var createHandler = function(index) {
      return function(evt) {
        self.showMask(index);
        evt.preventDefault();
      };
    };

    for(var i = 0; i < codes.length; i++) {
      var handler = createHandler(i);
      codes[i].addEventListener('focus', handler);
      codes[i].addEventListener('click', handler);
    }

    mask.addEventListener('blur', function() {
      self.hideMask();
    });

    mask.addEventListener('keydown', function(evt) {
      self.onKeyDown(evt);
    });
  }

  PinCodeInput.prototype = {
    showMask: function(index) {
      this._mask.blur();
      this._mask.classList.add('visible');
      this.moveMask(index);
      this._mask.focus();
    },

    hideMask: function() {
      this.writeBack();
      this._mask.blur();
      this._mask.classList.remove('visible');
    },

    moveMask: function(index) {
      this._index = index;
      this._mask.style.left = this._codes[index].offsetLeft + 'px';
      this._mask.value = this._codes[index].textContent;
      this._mask.select();
    },

    moveNext: function() {
      if (this._index < this._codes.length - 1) {
        this.moveMask(this._index + 1);
        return true;
      }
      return false;
    },

    movePrev: function() {
      if (this._index > 0) {
        this.moveMask(this._index - 1);
        return true;
      }
      return false;
    },

    empty: function() {
      for (var i = 0; i < this._codes.length; i++) {
        this.setCode(i, '');
      }
    },

    writeBack: function() {
      this.setCode(this._index, this._mask.value);
    },

    setCode: function(index, value) {
      if (value.length) {
        this._codes[index].classList.remove('placeholder');
        this._codes[index].textContent = value.charAt(0);
      } else {
        this._codes[index].classList.add('placeholder');
        this._codes[index].textContent = '';
      }
    },

    getCodes: function() {
      var code = '';
      for (var i = 0; i < this._codes.length; i++) {
        if (this._codes[i].textContent !== '') {
          code += this._codes[i].textContent;
        } else {
          return '';
        }
      }
      return code;
    },

    highlightEmptyCode: function() {
      for (var i = 0; i < this._codes.length; i++) {
        if (this._codes[i].textContent === '') {
          this.showMask(i);
          return true;
        }
      }
      return false;
    },

    onKeyDown: function(evt) {
      var c = evt.keyCode;

      if (evt.ctrlKey || evt.altKey || evt.metaKey) {
        return;
      }

      // backspace to delete the previous field if current one is empty.
      if (c == 8 && this._mask.value === '') {
        if (this._index > 0) {
          this.writeBack();
          this.setCode(this._index - 1, '');
          this.movePrev();
        } else {
          this.hideMask();
        }
        evt.preventDefault();
        return;
      }

      // numbers
      if (!evt.shiftKey && ((c >= 48 && c <= 57) || (c >= 96 && c <= 105))) {
        showMessage('');

        var num = String.fromCharCode(c >= 96 ? c - 96 + 48 : c);
        this._mask.value = num;
        this.writeBack();
        if (!this.moveNext()) {
          this._submitButton.focus();
        }
        evt.preventDefault();
        return;
      }

      // tab
      if (c == 9) {
        this.writeBack();
        if (evt.shiftKey) {
          if (!this.movePrev()) {
            this.hideMask();
          }
        } else {
          if (!this.moveNext()) {
            this._submitButton.focus();
          }
        }
        evt.preventDefault();
        return;
      }

      // allowed function keys: backspace, shift, del and F5.
      if ([8, 16, 46, 116].indexOf(c) < 0) {
        evt.preventDefault();
        return;
      }
    }
  };

  exports.ready(init);
}(window));
