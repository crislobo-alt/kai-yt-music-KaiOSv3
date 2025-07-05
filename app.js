localforage.setDriver(localforage.INDEXEDDB);

var BOOT = false;
var SLEEP_TIMER = null;
var WAKE_LOCK = null;
var QR_READER = null;
const CACHED_DECRYPTOR = {};
const DEFAULT_VOLUME = 0.02;

const DB_NAME = 'YT_MUSIC';
const DB_AUDIO = 'YT_AUDIO';
const DB_PLAYLIST = 'YT_PLAYLIST';
const DB_CACHED_URL = 'YT_CACHED_URL';
const DB_PLAYING = 'YT_PLAYING';
const DB_CONFIGURATION = 'YT_CONFIGURATION';

const T_AUDIO = localforage.createInstance({
  name: DB_NAME,
  storeName: DB_AUDIO
});

const T_PLAYLIST = localforage.createInstance({
  name: DB_NAME,
  storeName: DB_PLAYLIST
});

const T_CACHED_URL = localforage.createInstance({
  name: DB_NAME,
  storeName: DB_CACHED_URL
});

const T_CONFIGURATION = localforage.createInstance({
  name: DB_NAME,
  storeName: DB_CONFIGURATION
});

var MAIN_DURATION_ELAPSED;
var MAIN_DURATION_SLIDER;
var MAIN_CURRENT_TIME;
var MAIN_DURATION;
var MAIN_THUMB;
var MAIN_TITLE;
var MAIN_PLAY_BTN;
var MAIN_BUFFERING;
var MAIN_BUFFERED;

var LFT_DBL_CLICK_TH = 0;
var LFT_DBL_CLICK_TIMER = undefined;
var RGT_DBL_CLICK_TH = 0;
var RGT_DBL_CLICK_TIMER = undefined;

function putCachedURL(obj, url) {
  var params = getURLParam('expire', url);
  var expire = params[0];
  if (expire == null) {
    const segments = url.split('/');
    var idx = segments.indexOf('expire');
    if (idx > -1)
      idx++;
    if (isNaN(segments[idx]) === false)
      expire = parseInt(segments[idx]);
  }
  if (expire) {
    T_CACHED_URL.getItem(obj.id)
      .then((cached) => {
        if (cached == null)
          cached = {};
        cached[obj.bitrate] = {
          url: url,
          expire: parseInt(expire) * 1000
        };
        return T_CACHED_URL.setItem(obj.id, cached);
      })
      .then((saved) => {
        console.log('CACHED:', obj.id, saved);
      })
      .catch((err) => {
        console.log(err);
      })
  }
}

function getCachedURL(id, bitrate = null) {
  return new Promise((resolve, reject) => {
    T_CACHED_URL.getItem(id)
      .then((cached) => {
        if (cached == null) {
          reject("ID not exist");
          return;
        }
        if (bitrate != null && cached[bitrate] == null) {
          reject("Bitrate not exist");
          return;
        }
        if (bitrate === null) {
          const keys = Object.keys(cached);
          bitrate = parseInt(keys[keys.length - 1]);
        }
        if (new Date() < new Date(cached[bitrate]['expire'])) {
          console.log('FOUND:', id, bitrate);
          resolve(cached[bitrate]['url']);
          return;
        }
        reject("Expired link");
      })
      .catch((err) => {
        reject(err);
      });
  });
}

window.addEventListener("load", () => {

  const dummy = new Kai({
    name: '_dummy_',
    data: {
      title: '_dummy_'
    },
    verticalNavClass: '.dummyNav',
    templateUrl: document.location.origin + '/templates/dummy.html',
    mounted: function() {},
    unmounted: function() {},
    methods: {},
    softKeyText: {
      left: 'L2',
      center: 'C2',
      right: 'R2'
    },
    softKeyListener: {
      left: function() {},
      center: function() {},
      right: function() {}
    },
    dPadNavListener: {
      arrowUp: function() {
        this.navigateListNav(-1);
      },
      arrowDown: function() {
        this.navigateListNav(1);
      }
    }
  });

  const DS = new DataStorage(() => {}, () => {}, false);
  navigator.getDeviceStorages('sdcard')[0].get('trigger_permission').catch((err) => {
    console.warn('Device storage access check failed:', err);
  });


  var TRACK_NAME = '';
  var TRACKLIST = [];
  var TRACKLIST_DEFAULT_SORT = [];

  const state = new KaiState({
    MAIN_PLAYER_DURATION: 0,
    CONFIGURATION: {},
    DATABASE: {},
    PLAYLIST: {},
    TRACKLIST_IDX: 0,
    REPEAT: -1,
    SHUFFLE: false,
    AUTOPLAY: JSON.parse(localStorage.getItem('AUTOPLAY')) || false,
    AUTOSLEEP: JSON.parse(localStorage.getItem('AUTOSLEEP')) || false,
    INVIDIOUS: JSON.parse(localStorage.getItem('INVIDIOUS')) || false,
  });

  const MAIN_PLAYER = document.createElement("audio");
  MAIN_PLAYER.volume = 1;
  if (MAIN_PLAYER.mozAudioChannelType !== undefined) {
    MAIN_PLAYER.mozAudioChannelType = 'content';
  }


  MAIN_PLAYER.onloadedmetadata = (e) => {
    state.setState('MAIN_PLAYER_DURATION', e.target.duration);
  }

  MAIN_PLAYER.onended = (e) => {
    const REPEAT = state.getState('REPEAT');
    if (REPEAT === 1) {
      MAIN_PLAYER.play();
    } else if (REPEAT === 0) {
      const next = state.getState('TRACKLIST_IDX') + 1;
      if (TRACKLIST[next]) {
        state.setState('TRACKLIST_IDX', next);
        playMainAudio(next);
      } else {
        state.setState('TRACKLIST_IDX', 0);
        playMainAudio(0);
      }
    } else if (REPEAT === -1 && (state.getState('TRACKLIST_IDX') !== (TRACKLIST.length - 1))) {
      const next = state.getState('TRACKLIST_IDX') + 1;
      if (TRACKLIST[next]) {
        state.setState('TRACKLIST_IDX', next);
        playMainAudio(next);
      }
    }
  }

  function toggleVolume(PLYR, $router) {
    if (navigator.volumeManager && navigator.volumeManager.requestShow) {
      navigator.volumeManager.requestShow();
      $router.setSoftKeyRightText('');
    } else {
      $router.setSoftKeyRightText((PLYR.volume * 100).toFixed(0) + '%');
    }
  }

  function volumeUp(PLYR, $router, cb = () => {}) {
    if (navigator.volumeManager && navigator.volumeManager.requestUp) {
      navigator.volumeManager.requestUp();
    } else {
      if (PLYR.volume < 1) {
        PLYR.volume = parseFloat((PLYR.volume + DEFAULT_VOLUME).toFixed(2));
        cb(PLYR, $router);
        $router.showToast('Volume ' + (PLYR.volume * 100).toFixed(0).toString() + '%');
      }
    }
  }

  function volumeDown(PLYR, $router, cb = () => {}) {
    if (navigator.volumeManager && navigator.volumeManager.requestDown) {
      navigator.volumeManager.requestDown();
    } else {
      if (PLYR.volume > 0) {
        PLYR.volume = parseFloat((PLYR.volume - DEFAULT_VOLUME).toFixed(2));
        cb(PLYR, $router);
        $router.showToast('Volume ' + (PLYR.volume * 100).toFixed(0).toString() + '%');
      }
    }
  }

  function toggleShuffle($router) {
    const SHUFFLE = !state.getState('SHUFFLE');
    const SHUFFLE_BTN = {};
    if (SHUFFLE) {
      SHUFFLE_BTN.classList = '';
      if ($router)
        $router.showToast('Shuffle On');
    } else {
      SHUFFLE_BTN.classList = 'inactive';
      if ($router)
        $router.showToast('Shuffle Off');
    }
    state.setState('SHUFFLE', SHUFFLE);
    T_CONFIGURATION.setItem('SHUFFLE', SHUFFLE);
    shuffling();
    return SHUFFLE_BTN;
  }

  function shuffling() {
    if (TRACKLIST.length <= 1)
      return
    const SHUFFLE = state.getState('SHUFFLE');
    if (SHUFFLE) {
      const v_id = TRACKLIST[state.getState('TRACKLIST_IDX')].id;
      for (var i = 0; i < TRACKLIST.length - 1; i++) {
        var j = i + Math.floor(Math.random() * (TRACKLIST.length - i));
        var temp = TRACKLIST[j];
        TRACKLIST[j] = TRACKLIST[i];
        TRACKLIST[i] = temp;
      }
      const idx = TRACKLIST.findIndex((t) => {
        return t.id === v_id;
      });
      const t = TRACKLIST[0];
      const b = TRACKLIST[idx];
      TRACKLIST[idx] = t;
      TRACKLIST[0] = b;
      state.setState('TRACKLIST_IDX', 0);
    } else {
      const v_id = TRACKLIST[state.getState('TRACKLIST_IDX')].id;
      TRACKLIST = JSON.parse(JSON.stringify(TRACKLIST_DEFAULT_SORT));
      const idx = TRACKLIST.findIndex((t) => {
        return t.id === v_id;
      });
      state.setState('TRACKLIST_IDX', idx);
    }
  }

  function toggleRepeat($router) {
    var REPEAT = state.getState('REPEAT');
    REPEAT++;
    const REPEAT_BTN = {};
    if (REPEAT === 0) {
      REPEAT_BTN.src = '/icons/img/baseline_repeat_white_18dp.png';
      REPEAT_BTN.classList = '';
      if ($router)
        $router.showToast('Repeat On');
    } else if (REPEAT === 1) {
      REPEAT_BTN.src = '/icons/img/baseline_repeat_one_white_18dp.png';
      REPEAT_BTN.classList = '';
      if ($router)
        $router.showToast('Repeat One');
    } else {
      REPEAT = -1;
      REPEAT_BTN.src = '/icons/img/baseline_repeat_white_18dp.png';
      REPEAT_BTN.classList = 'inactive';
      if ($router)
        $router.showToast('Repeat Off');
    }
    state.setState('REPEAT', REPEAT);
    T_CONFIGURATION.setItem('REPEAT', REPEAT);
    return REPEAT_BTN;
  }

  function init(dbg = null) {
    console.log('INIT:', dbg);
    T_CONFIGURATION.getItem('SHUFFLE')
      .then((SHUFFLE) => {
        if (SHUFFLE == null)
          SHUFFLE = false;
        state.setState('SHUFFLE', SHUFFLE);
        T_CONFIGURATION.setItem('SHUFFLE', SHUFFLE);
        localforage.getItem(DB_PLAYLIST)
          .then((playlist_id) => {
            if (playlist_id == null) {
              playDefaultPlaylist();
            } else {
              playPlaylistById(playlist_id);
            }
          });
      });
  }

  T_CONFIGURATION.keys()
    .then((keys) => {
      const kv = {}
      var done = keys.length;
      keys.forEach((key) => {
        T_CONFIGURATION.getItem(key)
          .then((value) => {
            kv[key] = value;
            done--;
            if (done <= 0) {
              state.setState('CONFIGURATION', kv);
            }
          })
          .catch((err) => {
            console.log(err);
            done--;
            if (done <= 0) {
              state.setState('CONFIGURATION', kv);
              console.log(state.getState('CONFIGURATION'));
            }
          });
      });
    }).catch((err) => {
      console.log(err);
    });

  T_AUDIO.keys()
    .then((keys) => {
      var success = 0;
      var fail = 0;
      var done = keys.length;
      if (done === 0)
        init('Empty');
      keys.forEach((key) => {
        T_AUDIO.getItem(key)
          .then((value) => {
            const list = state.getState('DATABASE');
            list[key] = value;
            state.setState('DATABASE', list);
            success++;
            done--;
            if (done <= 0)
              init(`${success}, ${fail}`);
          })
          .catch((err) => {
            fail++;
            done--;
            if (done <= 0)
              init(`${success}, ${fail}`);
          });
      });
    })
    .catch((err) => {
      console.log(err);
      init(err.toString());
    });

  T_PLAYLIST.keys()
    .then((keys) => {
      keys.forEach((key) => {
        T_PLAYLIST.getItem(key.toString())
          .then((value) => {
            const list = state.getState('PLAYLIST');
            list[key] = value;
            state.setState('PLAYLIST', list);
          })
      });
    })
    .catch((err) => {
      console.log(err);
    });

  function playDefaultPlaylist() {
    TRACKLIST = [];
    TRACKLIST_DEFAULT_SORT = [];
    localforage.removeItem(DB_PLAYLIST);
    state.setState('TRACKLIST_IDX', 0);
    TRACK_NAME = 'YT MUSIC';
    const tracks = state.getState('DATABASE');
    for (var y in tracks) {
      TRACKLIST.push(tracks[y]);
      TRACKLIST_DEFAULT_SORT.push(tracks[y]);
    }
    shuffling();
    playMainAudio(state.getState('TRACKLIST_IDX'));
  }

  function playPlaylistById(id) {
    T_PLAYLIST.getItem(id.toString())
      .then((result) => {
        if (result == null) {
          playDefaultPlaylist();
          return Promise.reject('Playlist not exist');
        }
        return Promise.resolve(result);
      })
      .then((playlist) => {
        const tracks = state.getState('DATABASE');
        const list = []
        playlist.collections.forEach((c) => {
          if (tracks[c]) {
            list.push(tracks[c]);
          }
        });
        state.setState('TRACKLIST_IDX', 0);
        TRACK_NAME = playlist.name;
        TRACKLIST = list;
        TRACKLIST_DEFAULT_SORT = JSON.parse(JSON.stringify(list));
        shuffling();
        playMainAudio(state.getState('TRACKLIST_IDX'));
        router.showToast(`PLAYING ${TRACK_NAME}`);
        localforage.setItem(DB_PLAYLIST, playlist.id);
      })
      .catch((e) => {
        router.showToast(e.toString());
      });
  }

  function getAudioStreamURL(id) {
    return getVideoLinks(id)
      .then((links) => {
        if (router && router.loading) {
          router.hideLoading();
        }
        var obj = null;
        var quality = 0;
        const MIME = state.getState('CONFIGURATION')['mimeType'] || 'audio';
        links.forEach((link) => {
          if (link.mimeType.indexOf(MIME) > -1) {
            var bitrate = parseInt(link.bitrate);
            if (bitrate > 999) {
              bitrate = Math.round(bitrate / 1000);
            }
            link.bitrate = bitrate;
            if (link.bitrate >= quality) {
              obj = link;
              quality = link.bitrate;
            }
          }
        });
        return Promise.resolve(obj);
      })
      .then((obj) => {
        if (obj.url != null) {
          return Promise.resolve(obj.url);
        } else {
          return getCachedURL(obj.id, obj.bitrate)
            .then((_url) => {
              return Promise.resolve(_url);
            })
            .catch((_err) => {
              return decryptSignatureV2(obj.signatureCipher, obj.player)
                .then((url) => {
                  putCachedURL(obj, url);
                  return Promise.resolve(url);
                })
                .catch((err) => {
                  return Promise.reject(err);
                })
            });
        }
      })
      .catch((e) => {
        return Promise.reject(e);
      });
  }

  const qrReader = function($router, cb = () => {}) {
    $router.showBottomSheet(
      new Kai({
        name: 'qrReader',
        data: {
          title: 'qrReader'
        },
        template: `<div class="kui-flex-wrap" style="overflow:hidden!important;height:264px;"><video id="qr_video" height="320" width="240" autoplay></video></div>`,
        mounted: function() {
          navigator.mediaDevices.getUserMedia({
              audio: false,
              video: true
            })
            .then((stream) => {
              const video = document.getElementById("qr_video");
              video.srcObject = stream;
              video.onloadedmetadata = (e) => {
                video.play();
                var barcodeCanvas = document.createElement("canvas");
                QR_READER = setInterval(() => {
                  barcodeCanvas.width = video.videoWidth;
                  barcodeCanvas.height = video.videoHeight;
                  var barcodeContext = barcodeCanvas.getContext("2d");
                  var imageWidth = Math.max(1, Math.floor(video.videoWidth)),
                    imageHeight = Math.max(1, Math.floor(video.videoHeight));
                  barcodeContext.drawImage(video, 0, 0, imageWidth, imageHeight);
                  var imageData = barcodeContext.getImageData(0, 0, imageWidth, imageHeight);
                  var idd = imageData.data;
                  let code = jsQR(idd, imageWidth, imageHeight);
                  if (code) {
                    cb(code.data);
                  }
                }, 1000);
              };
            }).catch((err) => {
              $router.showToast(err.toString());
            });
        },
        unmounted: function() {
          if (QR_READER) {
            clearInterval(QR_READER);
            QR_READER = null;
          }
          const video = document.getElementById("qr_video");
          if (video && video.srcObject) {
            const stream = video.srcObject;
            const tracks = stream.getTracks();
            tracks.forEach(function(track) {
              track.stop();
            });
            video.srcObject = null;
          }
        },
      })
    );
  }

  function downloadAudio($router, audio, cb = () => {}) {
    return new Promise((resolve, reject) => {
      $router.showLoading();
      getAudioStreamURL(audio.id)
        .then((url) => {
          var BAR, CUR, MAX;
          var start = 0;
          var loaded = 0;
          var req = new XMLHttpRequest();
          req.open('GET', url, true);
          req.responseType = 'blob';
          $router.showBottomSheet(
            new Kai({
              name: 'downloaderPopup',
              data: {
                title: 'downloaderPopup',
                downloading: false,
              },
              templateUrl: document.location.origin + '/templates/downloaderPopup.html',
              softKeyText: {
                left: 'Cancel',
                center: '0KB/S',
                right: '0%'
              },
              softKeyListener: {
                left: function() {
                  $router.hideBottomSheet();
                  req.abort();
                },
                center: function() {},
                right: function() {}
              },
              mounted: function() {
                if ('wakeLock' in navigator && navigator.wakeLock) {
                  navigator.wakeLock.request('screen').then((lock) => {
                    WAKE_LOCK = lock;
                    console.log('Wake Lock acquired');
                  }).catch((err) => {
                    console.warn('Failed to acquire Wake Lock:', err);
                  });
                } else {
                  console.warn('Wake Lock API not supported. Screen might dim.');
                }

                BAR = document.getElementById('download_bar');
                CUR = document.getElementById('download_cur');
                MAX = document.getElementById('download_max');
                req.onprogress = this.methods.onprogress;
                req.onreadystatechange = this.methods.onreadystatechange;
                req.onerror = this.methods.onerror;
                start = new Date().getTime();
                req.send();
              },
              unmounted: function() {
                if (WAKE_LOCK) {
                  WAKE_LOCK.release();
                  WAKE_LOCK = null;
                  console.log('Wake Lock released');
                }
                resolve(audio);
                setTimeout(cb, 100);
              },
              methods: {
                onprogress: function(evt) {
                  if (evt.lengthComputable) {
                    var end = new Date().getTime();
                    var elapsed = end - start;
                    start = end;
                    var percentComplete = evt.loaded / evt.total * 100;
                    const frag = evt.loaded - loaded;
                    loaded = evt.loaded;
                    const speed = (frag / elapsed) * 1000;
                    BAR.style.width = `${percentComplete.toFixed(2)}%`;
                    CUR.innerHTML = `${readableFileSize(evt.loaded, true, 2)}`;
                    $router.setSoftKeyCenterText(`${readableFileSize(Math.round(speed), true)}/s`);
                    $router.setSoftKeyRightText(BAR.style.width);
                    MAX.innerHTML = `${readableFileSize(evt.total, true, 2)}`;
                  }
                },
                onreadystatechange: function(evt) {
                  if (evt.currentTarget.readyState === 4) {
                    if (evt.currentTarget.response != null && evt.currentTarget.status >= 200 && evt.currentTarget.status <= 399) {
                      var ext = 'mp3';
                      if (window.MIME && window.MIME[evt.currentTarget.response.type] != null) {
                        ext = window.MIME[evt.currentTarget.response.type];
                      } else {
                        if (evt.currentTarget.response.type.includes('audio/mpeg')) ext = 'mp3';
                        else if (evt.currentTarget.response.type.includes('audio/webm')) ext = 'webm';
                        else if (evt.currentTarget.response.type.includes('audio/mp4')) ext = 'm4a';
                      }

                      var localPath = ['ytm', 'cache'];
                      if (DS.deviceStorage && DS.deviceStorage.storageName && DS.deviceStorage.storageName != '') {
                        localPath = [DS.deviceStorage.storageName, ...localPath];
                      }
                      DS.addFile(localPath, `${audio.id}.${ext}`, evt.currentTarget.response)
                        .then((file) => {
                          audio['local_stream'] = file.name;
                          $router.setSoftKeyCenterText('SUCCESS');
                          $router.setSoftKeyLeftText('Close');
                          if (WAKE_LOCK) {
                            WAKE_LOCK.release();
                            WAKE_LOCK = null;
                          }
                        })
                        .catch((err) => {
                          console.log(err);
                          $router.setSoftKeyCenterText('FAIL');
                          $router.setSoftKeyLeftText('Exit');
                        });
                    }
                  }
                },
                onerror: function(err) {
                  console.log(err);
                  $router.setSoftKeyCenterText('FAIL');
                  $router.setSoftKeyRightText('Exit');
                  $router.showToast('Network Error');
                }
              },
              backKeyListener: function(evt) {
                return true;
              }
            })
          );
        })
        .catch((e) => {
          $router.showToast("Stream Unavailable");
        })
        .finally(() => {
          $router.hideLoading();
        });
    });
  }

  function playMainAudioFallback(audio) {
    getCachedURL(audio.id)
      .then((url) => {
        if (MAIN_PLAYER.mozAudioChannelType !== undefined) {
          MAIN_PLAYER.mozAudioChannelType = 'content';
        }
        MAIN_PLAYER.src = url;
        if (state.getState('AUTOPLAY') && BOOT == false)
          MAIN_PLAYER.play();
        else if (BOOT)
          MAIN_PLAYER.play();
        BOOT = true;
      })
      .catch((err) => {
        getAudioStreamURL(audio.id)
          .then((url) => {
            if (MAIN_PLAYER.mozAudioChannelType !== undefined) {
              MAIN_PLAYER.mozAudioChannelType = 'content';
            }
            MAIN_PLAYER.src = url;
            if (state.getState('AUTOPLAY') && BOOT == false)
              MAIN_PLAYER.play();
            else if (BOOT)
              MAIN_PLAYER.play();
            BOOT = true;
          })
          .catch((err) => {
            console.log(err);
          });
      });
  }

  function playMainAudio(idx) {
    if (TRACKLIST[idx] == null) {
      return;
    }
    if (TRACKLIST[idx].local_stream) {
      DS.__getFile__(TRACKLIST[idx].local_stream)
        .then((file) => {
          if (MAIN_PLAYER.mozAudioChannelType !== undefined) {
            MAIN_PLAYER.mozAudioChannelType = 'content';
          }
          MAIN_PLAYER.src = window.URL.createObjectURL(file);
          if (state.getState('AUTOPLAY') && BOOT == false)
            MAIN_PLAYER.play();
          else if (BOOT)
            MAIN_PLAYER.play();
          BOOT = true;
        })
        .catch((err) => {
          playMainAudioFallback(TRACKLIST[idx]);
          console.warn("Unable to get the file: " + err.toString());
        });
    } else {
      playMainAudioFallback(TRACKLIST[idx]);
    }
  }

  function playMiniAudio($router, obj) {
    if (obj.url != null) {
      miniPlayer($router, obj.url);
    } else {
      $router.showLoading();
      getCachedURL(obj.id, obj.bitrate)
        .then((_url) => {
          $router.hideLoading();
          miniPlayer($router, _url);
        })
        .catch((_err) => {
          console.log(_err);
          decryptSignatureV2(obj.signatureCipher, obj.player)
            .then((url) => {
              putCachedURL(obj, url);
              miniPlayer($router, url);
            })
            .catch((err) => {
              console.log(err);
            })
            .finally(() => {
              $router.hideLoading();
            });
        });
    }
  }

  const miniPlayer = function($router, url) {

    var PLAY_BTN, DURATION_SLIDER, CURRENT_TIME, DURATION, DURATION_ELAPSED, BUFFERED;
    const MINI_PLAYER = document.createElement("audio");
    MINI_PLAYER.volume = 1;
    if (MINI_PLAYER.mozAudioChannelType !== undefined) {
      MINI_PLAYER.mozAudioChannelType = 'content';
    }


    $router.showBottomSheet(
      new Kai({
        name: 'miniPlayer',
        data: {
          title: 'miniPlayer',
          duration: 0,
        },
        templateUrl: document.location.origin + '/templates/miniPlayer.html',
        softKeyText: {
          left: 'Exit',
          center: '',
          right: ''
        },
        softKeyListener: {
          left: function() {
            $router.hideBottomSheet();
          },
          center: function() {
            if (MINI_PLAYER.duration > 0 && !MINI_PLAYER.paused) {
              MINI_PLAYER.pause();
            } else {
              MINI_PLAYER.play();
            }
          },
          right: function() {}
        },
        mounted: function() {

          DURATION_ELAPSED = document.getElementById('duration_elapsed');
          DURATION_SLIDER = document.getElementById('duration_slider');
          CURRENT_TIME = document.getElementById('current_time');
          DURATION = document.getElementById('duration');
          PLAY_BTN = document.getElementById('play_btn');
          BUFFERED = document.getElementById('duration_buffered');
          MINI_PLAYER.addEventListener('loadedmetadata', this.methods.onloadedmetadata);
          MINI_PLAYER.addEventListener('timeupdate', this.methods.ontimeupdate);
          MINI_PLAYER.addEventListener('pause', this.methods.onpause);
          MINI_PLAYER.addEventListener('play', this.methods.onplay);
          MINI_PLAYER.addEventListener('seeking', this.methods.onseeking);
          MINI_PLAYER.addEventListener('seeked', this.methods.onseeked);
          MINI_PLAYER.addEventListener('ratechange', this.methods.onratechange);
          MINI_PLAYER.addEventListener('ended', this.methods.onended);
          MINI_PLAYER.addEventListener('error', this.methods.onerror);
          document.addEventListener('keydown', this.methods.onKeydown);
          if (!navigator.volumeManager || !navigator.volumeManager.requestShow) {
            $router.setSoftKeyRightText((MINI_PLAYER.volume * 100).toFixed(0) + '%');
          }
          MAIN_PLAYER.pause();
          MINI_PLAYER.src = url;
          MINI_PLAYER.play();
        },
        unmounted: function() {
          $router.hideLoading();
          MINI_PLAYER.pause();
          MINI_PLAYER.removeEventListener('loadedmetadata', this.methods.onloadedmetadata);
          MINI_PLAYER.removeEventListener('timeupdate', this.methods.ontimeupdate);
          MINI_PLAYER.removeEventListener('pause', this.methods.onpause);
          MINI_PLAYER.removeEventListener('play', this.methods.onplay);
          MINI_PLAYER.removeEventListener('seeking', this.methods.onseeking);
          MINI_PLAYER.removeEventListener('seeked', this.methods.onseeked);
          MINI_PLAYER.removeEventListener('ratechange', this.methods.onratechange);
          MINI_PLAYER.removeEventListener('ended', this.methods.onended);
          MINI_PLAYER.removeEventListener('error', this.methods.onerror);
          document.removeEventListener('keydown', this.methods.onKeydown);
        },
        methods: {
          onloadedmetadata: function(evt) {
            MINI_PLAYER.fastSeek(0);
            this.data.duration = evt.target.duration;
            DURATION.innerHTML = convertTime(evt.target.duration);
          },
          ontimeupdate: function(evt) {
            const duration = this.data.duration || 1;
            const value = ((evt.target.currentTime / duration) * 100).toFixed(2);
            var currentTime = evt.target.currentTime;
            CURRENT_TIME.innerHTML = convertTime(evt.target.currentTime);
            DURATION_SLIDER.style.marginLeft = `${value}%`;
            DURATION_ELAPSED.style.width = `${value}%`;
            if (MINI_PLAYER.buffered.length > 0) {
              const value = (MINI_PLAYER.buffered.end(MINI_PLAYER.buffered.length - 1) / duration) * 100;
              BUFFERED.style.width = `${(value+5).toFixed(2)}%`;
            }
          },
          onpause: function() {
            PLAY_BTN.src = '/icons/img/play.png';
          },
          onplay: function() {
            PLAY_BTN.src = '/icons/img/pause.png';
          },
          onseeking: function(evt) {
            $router.showLoading(false);
            const duration = this.data.duration || 1;
            const value = ((evt.target.currentTime / duration) * 100).toFixed(2);
            CURRENT_TIME.innerHTML = convertTime(evt.target.currentTime);
            DURATION_SLIDER.style.marginLeft = `${value}%`;
          },
          onseeked: function(evt) {
            $router.hideLoading();
          },
          onratechange: function() {
            $router.setSoftKeyCenterText(`${MINI_PLAYER.playbackRate}x`);
          },
          onended: function() {
            PLAY_BTN.src = '/icons/img/play.png';
          },
          onerror: function(evt) {
            MINI_PLAYER.pause();
            console.log(evt);
            PLAY_BTN.src = '/icons/img/play.png';
            if (evt.target.error.code === 4) {
              $router.showToast('Please clear caches');
            } else {
              $router.showToast('Error');
            }
          },
          onKeydown: function(evt) {
            switch (evt.key) {
              case '2':
                if (MINI_PLAYER.playbackRate >= 4)
                  return
                MINI_PLAYER.playbackRate += 0.25;
                break;
              case '5':
                MINI_PLAYER.playbackRate = 1;
                break;
              case '8':
                if (MINI_PLAYER.playbackRate <= 0.5)
                  return
                MINI_PLAYER.playbackRate -= 0.25;
                break;
            }
          }
        },
        dPadNavListener: {
          arrowUp: function() {
            volumeUp(MINI_PLAYER, $router, toggleVolume)
          },
          arrowRight: function() {
            MINI_PLAYER.fastSeek(MINI_PLAYER.currentTime + 10);
          },
          arrowDown: function() {
            volumeDown(MINI_PLAYER, $router, toggleVolume);
          },
          arrowLeft: function() {
            MINI_PLAYER.fastSeek(MINI_PLAYER.currentTime - 10);
          },
        },
        backKeyListener: function(evt) {
          return -1;
        }
      })
    );
  }

  const keypadshorcuts = new Kai({
    name: 'keypadshorcuts',
    data: {
      title: 'keypadshorcuts'
    },
    templateUrl: document.location.origin + '/templates/keypadshorcuts.html',
    mounted: function() {
      this.$router.setHeaderTitle('Keypad Shorcuts');
    },
    unmounted: function() {},
    methods: {},
    softKeyText: {
      left: '',
      center: '',
      right: ''
    },
    softKeyListener: {
      left: function() {},
      center: function() {},
      right: function() {}
    }
  });

  const settings = new Kai({
    name: 'settings',
    data: {
      title: 'settings',
      autoplay: false,
      autosleep: false,
    },
    verticalNavClass: '.settingNav',
    templateUrl: document.location.origin + '/templates/settings.html',
    mounted: function() {
      this.$router.setHeaderTitle('Settings');
      this.methods.listenState(this.$state.getState());
      this.$state.addGlobalListener(this.methods.listenState);
      this.methods.renderSoftKeyText();
    },
    unmounted: function() {
      this.$state.removeGlobalListener(this.methods.listenState);
    },
    methods: {
      listenState: function(data) {
        const obj = {};
        if (data['AUTOSLEEP'] != null) {
          obj['autosleep'] = JSON.parse(data['AUTOSLEEP']);
        }
        if (data['AUTOPLAY'] != null) {
          obj['autoplay'] = JSON.parse(data['AUTOPLAY']);
        }
        if (data['AUTOPLAY'] != null) {
          obj['invidious'] = JSON.parse(data['INVIDIOUS']);
          window['INVIDIOUS'] = obj['invidious'];
        }
        this.setData(obj);
      },
      changeAutoSleep: function() {
        const choices = [{
          'text': 'Off',
          value: false
        }, {
          'text': '1 Minutes(TEST)',
          value: 1
        }, {
          'text': '10 Minutes',
          value: 10
        }, {
          'text': '20 Minutes',
          value: 20
        }, {
          'text': '30 Minutes',
          value: 30
        }, {
          'text': '40 Minutes',
          value: 40
        }, {
          'text': '50 Minutes',
          value: 50
        }, {
          'text': '60 Minutes',
          value: 60
        }, ]
        const idx = choices.findIndex((opt) => {
          return opt.value === this.data.autosleep;
        });
        this.$router.showOptionMenu('Sleep Timer', choices, 'SELECT', (selected) => {
          const value = selected.value;
          localStorage.setItem('AUTOSLEEP', value);
          this.$state.setState('AUTOSLEEP', JSON.parse(localStorage.getItem('AUTOSLEEP')));
        }, this.methods.renderSoftKeyText, idx);
      },
      changeAutoPlay: function() {
        const value = !this.data.autoplay;
        localStorage.setItem('AUTOPLAY', value);
        this.$state.setState('AUTOPLAY', JSON.parse(localStorage.getItem('AUTOPLAY')));
      },
      changeInvidious: function() {
        const value = !this.data.invidious;
        window['INVIDIOUS'] = value;
        localStorage.setItem('INVIDIOUS', value);
        this.$state.setState('INVIDIOUS', JSON.parse(localStorage.getItem('INVIDIOUS')));
      },
      renderSoftKeyText: function() {
        setTimeout(() => {
          if (this.verticalNavIndex == 2) {
            this.$router.setSoftKeyText('Clear', 'SET', 'Show');
          } else if (this.verticalNavIndex == 3) {
            this.$router.setSoftKeyText('Clear', 'SET', 'Show');
          } else {
            this.$router.setSoftKeyText('', 'SELECT', '');
          }
        }, 100);
      }
    },
    softKeyText: {
      left: '',
      center: 'SELECT',
      right: ''
    },
    softKeyListener: {
      left: function() {}
    }
  });
});