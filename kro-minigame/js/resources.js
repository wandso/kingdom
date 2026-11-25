/**
 * 资源加载模块（微信小游戏）
 * ------------------------------------------------------------------
 * 用 wx.createImage() 异步加载 PNG，提供缓存与按需加载。
 * 主包资源随游戏启动加载；分包资源通过 wx.loadSubpackage 按需加载。
 */

var cache = {};       // path -> image 对象（已 loaded）
var pending = {};     // path -> Promise
var _subReady = null; // 分包就绪 promise
var _subLoaders = {}; // name -> promise

function loadImage(src) {
  if (cache[src]) return Promise.resolve(cache[src]);
  if (pending[src]) return pending[src];
  pending[src] = new Promise(function (resolve) {
    function doLoad() {
      var img;
      try {
        img = wx.createImage();
      } catch (e) {
        delete pending[src];
        return resolve(null);
      }
      img.onload = function () {
        cache[src] = img;
        delete pending[src];
        resolve(img);
      };
      img.onerror = function () {
        delete pending[src];
        resolve(null);
      };
      img.src = src;
    }
    // 分包内资源：先等分包加载完成再取图，避免过早请求导致永久失败
    if (src.indexOf('pkg_assets/') === 0 && _subReady) {
      _subReady.then(doLoad, doLoad);
    } else {
      doLoad();
    }
  });
  return pending[src];
}

function get(src) { return cache[src] || null; }
function preload(list) { return Promise.all(list.map(loadImage)); }

// 分包加载（微信小游戏）——幂等，记录就绪 promise 供分包内资源等待
function loadSubpackage(name) {
  if (_subLoaders[name]) return _subLoaders[name];
  _subLoaders[name] = new Promise(function (resolve) {
    if (!wx.loadSubpackage) return resolve({ ok: false, reason: 'unsupported' });
    var task = wx.loadSubpackage({
      name: name,
      success: function (res) { resolve({ ok: true, res: res }); },
      fail: function (err) { resolve({ ok: false, error: err }); },
    });
    if (task && task.onProgressUpdate) {
      task.onProgressUpdate(function () {});
    }
  });
  if (name === 'pkg_assets') _subReady = _subLoaders[name];
  return _subLoaders[name];
}

module.exports = {
  loadImage: loadImage,
  get: get,
  preload: preload,
  loadSubpackage: loadSubpackage,
  cache: cache,
};
