(function() {
    'use strict';

    // Promises!
    var Promise = (typeof module !== 'undefined' && module.exports) ?
                  require('promise') : this.Promise;

    var globalObject = this;
    var serializer = null;

    var ModuleType = {
        DEFINE: 1,
        EXPORT: 2,
        WINDOW: 3
    };

    // Attaching to window (i.e. no module loader) is the assumed,
    // simple default.
    var moduleType = ModuleType.WINDOW;

    // Find out what kind of module setup we have; if none, we'll just attach
    // localForage to the main window.
    if (typeof define === 'function' && define.amd) {
        moduleType = ModuleType.DEFINE;
    } else if (typeof module !== 'undefined' && module.exports) {
        moduleType = ModuleType.EXPORT;
    }

    function localforageGetItems(keys, callback) {
        var promise = localforage.ready().then(function() {
            var currentDriver = localforage.driver();

            if (currentDriver === localforage.INDEXEDDB) {
                return getItemsIndexedDB(keys);
            } else if (currentDriver === localforage.WEBSQL) {
                return getItemsWebsql(keys);
            } else {
                return getItemsGeneric(keys);
            }
        });
        executeCallback(promise, callback);
        return promise;
    }

    function getItemsGeneric(keys, callback) {
        var promise = new Promise(function(resolve, reject) {
            var itemPromises = [];

            for (var i = 0, len = keys.length; i < len; i++) {
                itemPromises.push(getItemKeyValue(keys[i]));
            }

            Promise.all(itemPromises).then(function(keyValuePairs) {
                var result = {};
                for (var i = 0, len = keyValuePairs.length; i < len; i++) {
                    var keyValuePair = keyValuePairs[i];

                    result[keyValuePair.key] = keyValuePair.value;
                }
                resolve(result);
            }).catch(reject);
        });
        executeCallback(promise, callback);
        return promise;
    }

    function getItemsIndexedDB(keys, callback) {
        function comparer (a,b) {
            return a < b ? -1 : a > b ? 1 : 0;
        }

        var promise = new Promise(function(resolve, reject) {
            localforage.ready().then(function() {
                // Thanks https://hacks.mozilla.org/2014/06/breaking-the-borders-of-indexeddb/
                var dbInfo = localforage._dbInfo;
                var store = dbInfo.db.transaction(dbInfo.storeName, 'readonly')
                            .objectStore(dbInfo.storeName);

                // Initialize IDBKeyRange; fall back to vendor-prefixed versions if needed.
                var IDBKeyRange = IDBKeyRange || globalObject.IDBKeyRange || globalObject.webkitIndexedDB ||
                    globalObject.mozIndexedDB || globalObject.OIndexedDB ||
                    globalObject.msIndexedDB;

                var set = keys.sort(comparer);

                var keyRangeValue = IDBKeyRange.bound(keys[0], keys[keys.length - 1], false, false);
                var req = store.openCursor(keyRangeValue);
                var result = {};
                var i = 0;
             
                req.onsuccess = function (/*event*/) {
                    var cursor = req.result; // event.target.result;
             
                    if (!cursor) {
                        resolve(result);
                        return;
                    }
             
                    var key = cursor.key;
             
                    while (key > set[i]) {
             
                        // The cursor has passed beyond this key. Check next.
                        i++;
             
                        if (i === set.length) {
                            // There is no next. Stop searching.
                            resolve(result);
                            return;
                        }
                    }
             
                    if (key === set[i]) {
                        // The current cursor value should be included and we should continue
                        // a single step in case next item has the same key or possibly our
                        // next key in set.
                        var value = cursor.value;
                        if (value === undefined) {
                            value = null;
                        }

                        result[key] = value;
                        // onfound(cursor.value);
                        cursor.continue();
                    } else {
                        // cursor.key not yet at set[i]. Forward cursor to the next key to hunt for.
                        cursor.continue(set[i]);
                    }
                };

                req.onerror = function(/*event*/) {
                    reject(req.error);
                };
            }).catch(reject);
        });
        executeCallback(promise, callback);
        return promise;
    }

    function getItemsWebsql(keys, callback) {
        var promise = new Promise(function(resolve, reject) {
            localforage.ready().then(getSerializer).then(function(serializer) {
                var dbInfo = localforage._dbInfo;
                dbInfo.db.transaction(function(t) {

                    var queryParts = new Array(keys.length);
                    for (var i = 0, len = keys.length; i < len; i++) {
                        queryParts[i] = '?';
                    }

                    t.executeSql('SELECT * FROM ' + dbInfo.storeName +
                        ' WHERE (key IN (' + queryParts.join(',') + '))', keys,
                        function(t, results) {

                            var result = {};

                            var rows = results.rows;
                            for (var i = 0, len = rows.length; i < len; i++) {
                                var item = rows.item(i);
                                var value = item.value;

                                // Check to see if this is serialized content we need to
                                // unpack.
                                if (value) {
                                    value = serializer.deserialize(value);
                                }

                                result[item.key] = value;
                            }

                            resolve(result);
                        },
                        function(t, error) {
                            reject(error);
                        });
                });
            }).catch(reject);
        });
        executeCallback(promise, callback);
        return promise;
    }


    function getSerializer() {
        if (serializer) {
            return Promise.resolve(serializer);
        }

        var serializerPromise = new Promise(function(resolve/*, reject*/) {
            // We allow localForage to be declared as a module or as a
            // library available without AMD/require.js.
            if (moduleType === ModuleType.DEFINE) {
                require(['localforageSerializer'], resolve);
            } else if (moduleType === ModuleType.EXPORT) {
                // Making it browserify friendly
                resolve(require('./../utils/serializer'));
            } else {
                resolve(globalObject.localforageSerializer);
            }
        });

        return serializerPromise.then(function(lib) {
            serializer = lib;
            return Promise.resolve(serializer);
        });
    }

    function getItemKeyValue(key, callback) {
        var promise = localforage.getItem(key).then(function(value) {
            return {
                key: key,
                value: value
            };
        });
        executeCallback(promise, callback);
        return promise;
    }

    function executeCallback(promise, callback) {
        if (callback) {
            promise.then(function(result) {
                callback(null, result);
            }, function(error) {
                callback(error);
            });
        }
    }

    function extendPrototype(localforage) {
        var localforagePrototype = Object.getPrototypeOf(localforage);
        if (localforagePrototype) {
            localforagePrototype.getItems = localforageGetItems;
        }
    }

    extendPrototype(localforage);

    if (moduleType === ModuleType.DEFINE) {
        define('localforageGetItems', function() {
            return localforageGetItems;
        });
    } else if (moduleType === ModuleType.EXPORT) {
        module.exports = localforageGetItems;
    } else {
        this.localforageGetItems = localforageGetItems;
    }
}).call(window);
