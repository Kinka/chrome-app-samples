var services = angular.module("whistle.services", []);
services.factory("fs", ["$q", function($q) {
  var fs = chrome.fileSystem,
      local = chrome.storage.local;
  
  function _getEntryId() {
    var delay = $q.defer();

    // entry id is saved so no need to pick up folder every time starting our proxy server
    local.get("entry_id", function(data) {
      if (data.entry_id)
        delay.resolve(data.entry_id);
      else
        fs.chooseEntry({type: 'openDirectory'}, function(entry) {
          if (!entry) {
            delay.reject('Unable to get directory entry');
            return;
          }

          var entryId = fs.retainEntry(entry);
          local.set({entry_id: entryId});
          delay.resolve(entryId);
        });
    });
    
      return delay.promise;
  }
    
  function _getEntryById(id) {
    var delay = $q.defer();

    fs.restoreEntry(id, function(entry) {
      console.log("当前代理目录：", entry.fullPath)
      delay.resolve(entry);
    });

    return delay.promise;
  }
  
  travers.cnt = 0;
  function travers(entry, filesMap, delay) {
    if (entry.name.indexOf(".") == 0) return;
    travers.cnt++;
    if (entry.isDirectory) {
      travers.cnt--;
      entry.createReader().readEntries(function(entries) {
        entries.forEach(function(e) {
          travers(e, filesMap, delay);
        });
      })
    } else {
      var key = entry.fullPath.toLocaleLowerCase();
      entry.file(function(file) {
        filesMap[key] = file;
        travers.cnt--;
        if (travers.cnt == 0) {
          delay.resolve(filesMap);
        }
      });
    }
  }
  
  function _getFilesMap(id) {
    var delay = $q.defer();

    fs.restoreEntry(id, function(entry) {
      if (!entry) {
        delay.reject('No entry!');
        return;
      }
      console.log("当前代理目录：", entry.fullPath)
      travers(entry, {'/': entry}, delay);
    });

    return delay.promise;
  }
  
  return {
    getEntryId: _getEntryId,
    getFilesMap: _getFilesMap
  };
}]);

services.factory("svr", ["$q", "fs", function($q, fs) {
  var socket = chrome.socket;
  var socketInfo;
  var filesMap = {};
  var dir = "";
  var host = "127.0.0.1";
  var port = "8888";
  
  function stringToUint8Array(string) {
    var buffer = new ArrayBuffer(string.length);
    var view = new Uint8Array(buffer);
    for(var i = 0; i < string.length; i++) {
      view[i] = string.charCodeAt(i);
    }
    return view;
  }
  
  function arrayBufferToString(buffer) {
    var str = '';
    var uArrayVal = new Uint8Array(buffer);
    for(var s = 0; s < uArrayVal.length; s++) {
      str += String.fromCharCode(uArrayVal[s]);
    }
    return str;
  }
  
  function writeErrorResponse(socketId, errorCode, keepAlive) {
    var file = { size: 0 };
    console.info("writeErrorResponse:: begin... ");
    console.info("writeErrorResponse:: file = " + file);
    var contentType = "text/plain"; //(file.type === "") ? "text/plain" : file.type;
    var contentLength = file.size;
    var header = stringToUint8Array("HTTP/1.0 " + errorCode + " Not Found\nContent-length: " + file.size + "\nContent-type:" + contentType + ( keepAlive ? "\nConnection: keep-alive" : "") + "\n\n");
    console.info("writeErrorResponse:: Done setting header...");
    var outputBuffer = new ArrayBuffer(header.byteLength + file.size);
    var view = new Uint8Array(outputBuffer)
    view.set(header, 0);
    console.info("writeErrorResponse:: Done setting view...");
    socket.write(socketId, outputBuffer, function(writeInfo) {
      console.log("WRITE", writeInfo);
      if (keepAlive) {
        readFromSocket(socketId);
      } else {
        socket.destroy(socketId);
        socket.accept(socketInfo.socketId, onAccept);
      }
    });
    console.info("writeErrorResponse::filereader:: end onload...");

    console.info("writeErrorResponse:: end...");
  }
  
  function write200Response(socketId, file, keepAlive) {
    var contentType = (file.type === "") ? "text/plain" : file.type;
    var contentLength = file.size;
    var header = stringToUint8Array("HTTP/1.0 200 OK\nContent-length: " + file.size + "\nContent-type:" + contentType + ( keepAlive ? "\nConnection: keep-alive" : "") + "\n\n");
    var outputBuffer = new ArrayBuffer(header.byteLength + file.size);
    var view = new Uint8Array(outputBuffer)
    view.set(header, 0);

    var fileReader = new FileReader();
    fileReader.onload = function(e) {
       view.set(new Uint8Array(e.target.result), header.byteLength);
       socket.write(socketId, outputBuffer, function(writeInfo) {
         console.log("WRITE", writeInfo);
         if (keepAlive) {
           readFromSocket(socketId);
         } else {
           socket.destroy(socketId);
           socket.accept(socketInfo.socketId, onAccept);
         }
      });
    };

    fileReader.readAsArrayBuffer(file);
  }
  
  function onAccept(acceptInfo) {
    console.log("ACCEPT", acceptInfo)
    readFromSocket(acceptInfo.socketId);
  }
  
  function readFromSocket(socketId) {
    //  Read in the data
    socket.read(socketId, function(readInfo) {
      console.log("READ", readInfo);
      // Parse the request.
      var data = arrayBufferToString(readInfo.data);
      if(data.indexOf("GET ") == 0) {
        var keepAlive = false;
        if (data.indexOf("Connection: keep-alive") != -1) {
          keepAlive = true;
        }

        // we can only deal with GET requests
        var uriEnd =  data.indexOf(" ", 4);
        if(uriEnd < 0) { /* throw a wobbler */ return; }
        var uri = data.substring(4, uriEnd).toLocaleLowerCase();
        // strip query string
        var q = uri.indexOf("?");
        if (q != -1) {
          uri = uri.substring(0, q);
        }
        var file = filesMap[uri];
        if(!!file == false) {
          console.warn("File does not exist..." + uri);
          writeErrorResponse(socketId, 404, keepAlive);
          return;
        }
//         logToScreen("GET 200 " + uri);
        write200Response(socketId, file, keepAlive);
      }
      else {
        // Throw an error
        socket.destroy(socketId);
      }
    });
  }
  
  function initLocalFiles(cb) {
    fs.getEntryId().then(function(id) {
      return id;
    }).then(function(id) {
      return fs.getFilesMap(id);
    }).then(function(_filesMap) {
      dir = _filesMap['/'].fullPath;
      delete _filesMap['/'];
      filesMap = _filesMap;
      
      cb && cb();
    });
  }
  
  function start() {
    var delay = $q.defer();
    
    socket.create("tcp", {}, function(_socketInfo) {
      socketInfo = _socketInfo; // global cache
      
      socket.listen(socketInfo.socketId, host, parseInt(port), 50, function(result) {
        console.log("LISTENING:", result);
        
        initLocalFiles(function() {
          socket.accept(socketInfo.socketId, onAccept);
        
          delay.resolve({'result': result, 'root': dir, 'socketInfo': _socketInfo});
        })
      });
    })
    
    return delay.promise;
  }
  
  function stop() {
    socket.destroy(socketInfo.socketId);
  }
  
  function getNetworkList() {
    var delay = $q.defer();
    
    socket.getNetworkList(function(interfaces) {
      delay.resolve(interfaces);
    });
    
    return delay.promise;
  }
  
  return {
    start: start,
    stop: stop,
    getNetworkList: getNetworkList
  }
}]);

var app = angular.module('whistle', ["whistle.services"]);
app.controller('ProxyCtrl', ['$scope', 'fs', 'svr', function($scope, fs, svr) {
    $scope.onStart = function() {
      svr.start().then(function(data) {
        console.log(data)
        $scope.root = data.root;
      })
    }
}]);