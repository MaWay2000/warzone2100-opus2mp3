(function (global) {
  'use strict';

  var MESSAGE_TYPES = {
    LOAD: 'LOAD',
    EXEC: 'EXEC',
    WRITE_FILE: 'WRITE_FILE',
    READ_FILE: 'READ_FILE',
    DELETE_FILE: 'DELETE_FILE',
    RENAME: 'RENAME',
    CREATE_DIR: 'CREATE_DIR',
    LIST_DIR: 'LIST_DIR',
    DELETE_DIR: 'DELETE_DIR',
    ERROR: 'ERROR',
    DOWNLOAD: 'DOWNLOAD',
    PROGRESS: 'PROGRESS',
    LOG: 'LOG',
    MOUNT: 'MOUNT',
    UNMOUNT: 'UNMOUNT'
  };

  var DEFAULT_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js';
  var nextMessageId = 0;

  var WORKER_SOURCE = String.raw`
const MESSAGE_TYPES = {
  LOAD: 'LOAD',
  EXEC: 'EXEC',
  WRITE_FILE: 'WRITE_FILE',
  READ_FILE: 'READ_FILE',
  DELETE_FILE: 'DELETE_FILE',
  RENAME: 'RENAME',
  CREATE_DIR: 'CREATE_DIR',
  LIST_DIR: 'LIST_DIR',
  DELETE_DIR: 'DELETE_DIR',
  ERROR: 'ERROR',
  DOWNLOAD: 'DOWNLOAD',
  PROGRESS: 'PROGRESS',
  LOG: 'LOG',
  MOUNT: 'MOUNT',
  UNMOUNT: 'UNMOUNT'
};

const DEFAULT_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js';
const UNKNOWN_MESSAGE_TYPE = new Error('unknown message type');
const NOT_LOADED_ERROR = new Error('ffmpeg is not loaded, call \`await ffmpeg.load()\` first');
const CORE_IMPORT_ERROR = new Error('failed to import ffmpeg-core.js');

let core = null;

function toErrorMessage(error) {
  if (!error) {
    return 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error.message) {
    return error.message;
  }
  return String(error);
}

function post(payload, transferList) {
  self.postMessage(payload, transferList || []);
}

async function loadCore(options) {
  const loadOptions = options || {};
  const wasFreshLoad = !core;
  let resolvedCoreURL = loadOptions.coreURL || DEFAULT_CORE_URL;

  try {
    importScripts(resolvedCoreURL);
  } catch (error) {
    if (!loadOptions.coreURL) {
      resolvedCoreURL = DEFAULT_CORE_URL.replace('/umd/', '/esm/');
    }

    const module = await import(resolvedCoreURL);
    self.createFFmpegCore = module.default;

    if (!self.createFFmpegCore) {
      throw CORE_IMPORT_ERROR;
    }
  }

  const resolvedWasmURL = loadOptions.wasmURL || resolvedCoreURL.replace(/\.js$/g, '.wasm');
  const resolvedWorkerURL = loadOptions.workerURL || resolvedCoreURL.replace(/\.js$/g, '.worker.js');

  core = await self.createFFmpegCore({
    mainScriptUrlOrBlob:
      resolvedCoreURL +
      '#' +
      btoa(
        JSON.stringify({
          wasmURL: resolvedWasmURL,
          workerURL: resolvedWorkerURL
        })
      )
  });

  core.setLogger(function (entry) {
    post({ type: MESSAGE_TYPES.LOG, data: entry });
  });

  core.setProgress(function (entry) {
    post({ type: MESSAGE_TYPES.PROGRESS, data: entry });
  });

  return wasFreshLoad;
}

function execCommand(payload) {
  const args = payload && payload.args ? payload.args : [];
  const timeout = payload && typeof payload.timeout === 'number' ? payload.timeout : -1;
  core.setTimeout(timeout);
  core.exec.apply(core, args);
  const result = core.ret;
  core.reset();
  return result;
}

self.onmessage = async function (event) {
  const message = event.data || {};
  const id = message.id;
  const type = message.type;
  const data = message.data;
  const transferList = [];
  let responseData;

  try {
    if (type !== MESSAGE_TYPES.LOAD && !core) {
      throw NOT_LOADED_ERROR;
    }

    switch (type) {
      case MESSAGE_TYPES.LOAD:
        responseData = await loadCore(data);
        break;
      case MESSAGE_TYPES.EXEC:
        responseData = execCommand(data);
        break;
      case MESSAGE_TYPES.WRITE_FILE:
        core.FS.writeFile(data.path, data.data);
        responseData = true;
        break;
      case MESSAGE_TYPES.READ_FILE:
        responseData = core.FS.readFile(data.path, { encoding: data.encoding });
        break;
      case MESSAGE_TYPES.DELETE_FILE:
        core.FS.unlink(data.path);
        responseData = true;
        break;
      case MESSAGE_TYPES.RENAME:
        core.FS.rename(data.oldPath, data.newPath);
        responseData = true;
        break;
      case MESSAGE_TYPES.CREATE_DIR:
        core.FS.mkdir(data.path);
        responseData = true;
        break;
      case MESSAGE_TYPES.LIST_DIR:
        responseData = core.FS.readdir(data.path).map(function (name) {
          const stat = core.FS.stat(data.path + '/' + name);
          return {
            name: name,
            isDir: core.FS.isDir(stat.mode)
          };
        });
        break;
      case MESSAGE_TYPES.DELETE_DIR:
        core.FS.rmdir(data.path);
        responseData = true;
        break;
      case MESSAGE_TYPES.MOUNT:
        responseData = Boolean(
          core.FS.filesystems[data.fsType] &&
            core.FS.mount(core.FS.filesystems[data.fsType], data.options, data.mountPoint)
        );
        break;
      case MESSAGE_TYPES.UNMOUNT:
        core.FS.unmount(data.mountPoint);
        responseData = true;
        break;
      default:
        throw UNKNOWN_MESSAGE_TYPE;
    }
  } catch (error) {
    post({
      id: id,
      type: MESSAGE_TYPES.ERROR,
      data: toErrorMessage(error)
    });
    return;
  }

  if (responseData instanceof Uint8Array) {
    transferList.push(responseData.buffer);
  }

  post(
    {
      id: id,
      type: type,
      data: responseData
    },
    transferList
  );
};
`;

  function toError(error) {
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === 'string') {
      return new Error(error);
    }
    return new Error(String(error));
  }

  function createAbortError(id) {
    return new DOMException('Message #' + id + ' was aborted', 'AbortError');
  }

  function FFmpeg() {
    this.worker = null;
    this.workerObjectUrl = null;
    this.pending = new Map();
    this.logHandlers = [];
    this.progressHandlers = [];
    this.loaded = false;
    this.handleMessage = this.handleMessage.bind(this);
  }

  FFmpeg.prototype.handleMessage = function (event) {
    var message = event.data || {};
    var type = message.type;
    var id = message.id;
    var data = message.data;
    var pendingEntry;

    if (type === MESSAGE_TYPES.LOG) {
      this.logHandlers.forEach(function (handler) {
        handler(data);
      });
      return;
    }

    if (type === MESSAGE_TYPES.PROGRESS) {
      this.progressHandlers.forEach(function (handler) {
        handler(data);
      });
      return;
    }

    pendingEntry = this.pending.get(id);
    if (!pendingEntry) {
      return;
    }

    pendingEntry.cleanup();
    this.pending.delete(id);

    if (type === MESSAGE_TYPES.ERROR) {
      pendingEntry.reject(toError(data));
      return;
    }

    if (type === MESSAGE_TYPES.LOAD) {
      this.loaded = true;
    }

    pendingEntry.resolve(data);
  };

  FFmpeg.prototype.ensureWorker = function (options) {
    var workerBlob;

    if (this.worker) {
      return;
    }

    if (options && options.classWorkerURL) {
      this.worker = new Worker(options.classWorkerURL, { type: 'module' });
    } else {
      workerBlob = new Blob([WORKER_SOURCE], { type: 'text/javascript' });
      this.workerObjectUrl = URL.createObjectURL(workerBlob);
      this.worker = new Worker(this.workerObjectUrl);
    }

    this.worker.onmessage = this.handleMessage;
  };

  FFmpeg.prototype.postMessage = function (message, transferList, signal) {
    var _this = this;
    var id;

    if (!this.worker) {
      return Promise.reject(new Error('ffmpeg is not loaded, call `await ffmpeg.load()` first'));
    }

    id = nextMessageId;
    nextMessageId += 1;

    return new Promise(function (resolve, reject) {
      var abortHandler = null;
      var cleanup = function () {
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      };

      if (signal) {
        if (signal.aborted) {
          reject(createAbortError(id));
          return;
        }

        abortHandler = function () {
          _this.pending.delete(id);
          cleanup();
          reject(createAbortError(id));
        };

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      _this.pending.set(id, {
        resolve: resolve,
        reject: reject,
        cleanup: cleanup
      });

      _this.worker.postMessage(
        {
          id: id,
          type: message.type,
          data: message.data
        },
        transferList || []
      );
    });
  };

  FFmpeg.prototype.on = function (eventName, handler) {
    if (eventName === 'log') {
      this.logHandlers.push(handler);
      return;
    }

    if (eventName === 'progress') {
      this.progressHandlers.push(handler);
    }
  };

  FFmpeg.prototype.off = function (eventName, handler) {
    if (eventName === 'log') {
      this.logHandlers = this.logHandlers.filter(function (candidate) {
        return candidate !== handler;
      });
      return;
    }

    if (eventName === 'progress') {
      this.progressHandlers = this.progressHandlers.filter(function (candidate) {
        return candidate !== handler;
      });
    }
  };

  FFmpeg.prototype.load = function (options, config) {
    var loadOptions = options || {};
    var signal = config && config.signal;

    if (!this.worker) {
      this.ensureWorker({ classWorkerURL: loadOptions.classWorkerURL });
    }

    return this.postMessage(
      {
        type: MESSAGE_TYPES.LOAD,
        data: {
          coreURL: loadOptions.coreURL,
          wasmURL: loadOptions.wasmURL,
          workerURL: loadOptions.workerURL
        }
      },
      undefined,
      signal
    );
  };

  FFmpeg.prototype.exec = function (args, timeout, config) {
    return this.postMessage(
      {
        type: MESSAGE_TYPES.EXEC,
        data: {
          args: args,
          timeout: typeof timeout === 'number' ? timeout : -1
        }
      },
      undefined,
      config && config.signal
    );
  };

  FFmpeg.prototype.writeFile = function (path, data, config) {
    var transferList = [];

    if (data instanceof Uint8Array) {
      transferList.push(data.buffer);
    } else if (data instanceof ArrayBuffer) {
      transferList.push(data);
    }

    return this.postMessage(
      {
        type: MESSAGE_TYPES.WRITE_FILE,
        data: {
          path: path,
          data: data
        }
      },
      transferList,
      config && config.signal
    );
  };

  FFmpeg.prototype.readFile = function (path, encoding, config) {
    return this.postMessage(
      {
        type: MESSAGE_TYPES.READ_FILE,
        data: {
          path: path,
          encoding: encoding || 'binary'
        }
      },
      undefined,
      config && config.signal
    );
  };

  FFmpeg.prototype.deleteFile = function (path, config) {
    return this.postMessage(
      {
        type: MESSAGE_TYPES.DELETE_FILE,
        data: { path: path }
      },
      undefined,
      config && config.signal
    );
  };

  FFmpeg.prototype.rename = function (oldPath, newPath, config) {
    return this.postMessage(
      {
        type: MESSAGE_TYPES.RENAME,
        data: {
          oldPath: oldPath,
          newPath: newPath
        }
      },
      undefined,
      config && config.signal
    );
  };

  FFmpeg.prototype.createDir = function (path, config) {
    return this.postMessage(
      {
        type: MESSAGE_TYPES.CREATE_DIR,
        data: { path: path }
      },
      undefined,
      config && config.signal
    );
  };

  FFmpeg.prototype.listDir = function (path, config) {
    return this.postMessage(
      {
        type: MESSAGE_TYPES.LIST_DIR,
        data: { path: path }
      },
      undefined,
      config && config.signal
    );
  };

  FFmpeg.prototype.deleteDir = function (path, config) {
    return this.postMessage(
      {
        type: MESSAGE_TYPES.DELETE_DIR,
        data: { path: path }
      },
      undefined,
      config && config.signal
    );
  };

  FFmpeg.prototype.mount = function (fsType, options, mountPoint) {
    return this.postMessage({
      type: MESSAGE_TYPES.MOUNT,
      data: {
        fsType: fsType,
        options: options,
        mountPoint: mountPoint
      }
    });
  };

  FFmpeg.prototype.unmount = function (mountPoint) {
    return this.postMessage({
      type: MESSAGE_TYPES.UNMOUNT,
      data: {
        mountPoint: mountPoint
      }
    });
  };

  FFmpeg.prototype.terminate = function () {
    this.pending.forEach(function (entry) {
      entry.cleanup();
      entry.reject(new Error('called FFmpeg.terminate()'));
    });

    this.pending.clear();
    this.loaded = false;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.workerObjectUrl) {
      URL.revokeObjectURL(this.workerObjectUrl);
      this.workerObjectUrl = null;
    }
  };

  global.FFmpegWASM = {
    FFmpeg: FFmpeg
  };
})(typeof self !== 'undefined' ? self : window);
