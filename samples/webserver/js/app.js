var app = angular.module('whistle', []);
app.controller('ProxyCtrl', ['$scope',
  function($scope) {
    
  }]);
  
onload = function() {return;
  var start = document.getElementById("start");
  var stop = document.getElementById("stop");
  var hosts = document.getElementById("hosts");
  var port = document.getElementById("port");

  var socket = chrome.socket;
  var socketInfo;
  var filesMap = {};

  var stringToUint8Array = function(string) {
    var buffer = new ArrayBuffer(string.length);
    var view = new Uint8Array(buffer);
    for(var i = 0; i < string.length; i++) {
      view[i] = string.charCodeAt(i);
    }
    return view;
  };

  var arrayBufferToString = function(buffer) {
    var str = '';
    var uArrayVal = new Uint8Array(buffer);
    for(var s = 0; s < uArrayVal.length; s++) {
      str += String.fromCharCode(uArrayVal[s]);
    }
    return str;
  };

  var logToScreen = function(log) {
    logger.textContent += log + "\n";
  }

  var writeErrorResponse = function(socketId, errorCode, keepAlive) {
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
  };

  var write200Response = function(socketId, file, keepAlive) {
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
  };

  var onAccept = function(acceptInfo) {
    console.log("ACCEPT", acceptInfo)
    readFromSocket(acceptInfo.socketId);
  };

  var readFromSocket = function(socketId) {
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
        logToScreen("GET 200 " + uri);
        write200Response(socketId, file, keepAlive);
      }
      else {
        // Throw an error
        socket.destroy(socketId);
      }
    });
  };

  start.onclick = function() {
    getEntryId(function(id) {
      getEntries(id, function(data) {
        data.forEach(function(e) {
          travers(e, filesMap);
        })
      })
    })
    
    socket.create("tcp", {}, function(_socketInfo) {
      socketInfo = _socketInfo;
      socket.listen(socketInfo.socketId, hosts.value, parseInt(port.value), 50, function(result) {
        console.log("LISTENING:", result);
        socket.accept(socketInfo.socketId, onAccept);
      });
    });

    stop.disabled = false;
    start.disabled = true;
  };

  stop.onclick = function() {
    stop.disabled = true;
    start.disabled = false;
    socket.destroy(socketInfo.socketId);
  };

  socket.getNetworkList(function(interfaces) {
    for(var i in interfaces) {
      var interface = interfaces[i];
      var opt = document.createElement("option");
      opt.value = interface.address;
      opt.innerText = interface.name + " - " + interface.address;
      hosts.appendChild(opt);
    }
  });
};

/*
chrome.fileSystem.chooseEntry({type: 'openDirectory'}, function(entry) {
  var id = chrome.fileSystem.retainEntry(entry);console.log(id)
})
*/
function getEntryId(cb) {
  var fs = chrome.fileSystem,
      local = chrome.storage.local;
  local.get("entry_id", function(data) {
    if (!cb) return;
    if (data.entry_id)
      cb(data.entry_id);
    else
      fs.chooseEntry({type: 'openDirectory'}, function(entry) {
        var entryId = fs.retainEntry(entry);
        local.set({entry_id: entryId});
        cb && cb(entryId);
      })
  });
}
function getEntries(id, cb) {
  var fs = chrome.fileSystem;
  //id = "91C7C34511A57DFF27A011CDB3BB0B1A:funding";
  //id = "0B105B24D4A95DACE83C1866B8351CC9:webserver";
  fs.restoreEntry(id, function(entry) {
    console.log("当前代理目录：", entry.fullPath)
    var dirReader = entry.createReader();
    dirReader.readEntries(function(entries) {
      cb && cb(entries);
    });
  });
}

function travers(entry, filesMap) {
  if (entry.name.indexOf(".") == 0) return;
  if (entry.isDirectory) {
    entry.createReader().readEntries(function(entries) {
      entries.forEach(function(e) {
        travers(e, filesMap);
      });
    })
  } else {
    var key = entry.fullPath.substr(entry.fullPath.indexOf("/", 1)).toLocaleLowerCase();
    entry.file(function(file) {
      filesMap[key] = file;
    })
    console.log(key);
  }
}