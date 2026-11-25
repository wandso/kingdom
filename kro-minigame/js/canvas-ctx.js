/**
 * Canvas2D 渲染适配器
 * ------------------------------------------------------------------
 * 微信小游戏的主屏 canvas 通过 wx.createCanvas() 获取，其 getContext('2d')
 * 是标准 Canvas2D API（fillStyle / strokeStyle / font / drawImage ...）。
 * 而原小程序引擎使用的是旧式封装接口（setFillStyle / setStrokeStyle /
 * setFontSize / draw(false) 等）。
 *
 * 本适配器给标准 ctx 补上旧式同名方法，使原引擎渲染代码零改动即可运行，
 * 同时保留全部标准 API。塔防引擎（update / render）因此可原样复用。
 */

function adapt(ctx) {
  if (!ctx) return ctx;
  if (ctx.__kroAdapted) return ctx;

  // 旧式 setter -> 标准属性
  if (!ctx.setFillStyle) ctx.setFillStyle = function (v) { this.fillStyle = v; };
  if (!ctx.setStrokeStyle) ctx.setStrokeStyle = function (v) { this.strokeStyle = v; };
  if (!ctx.setLineWidth) ctx.setLineWidth = function (v) { this.lineWidth = v; };
  if (!ctx.setLineCap) ctx.setLineCap = function (v) { this.lineCap = v; };
  if (!ctx.setLineJoin) ctx.setLineJoin = function (v) { this.lineJoin = v; };
  if (!ctx.setFontSize) ctx.setFontSize = function (v) {
    this.font = (v || 12) + 'px ' + (this._kroFontFamily || 'sans-serif');
  };
  if (!ctx.setTextAlign) ctx.setTextAlign = function (v) { this.textAlign = v; };
  if (!ctx.setTextBaseline) ctx.setTextBaseline = function (v) { this.textBaseline = v; };
  if (!ctx.setGlobalAlpha) ctx.setGlobalAlpha = function (v) { this.globalAlpha = v; };
  if (!ctx.setShadow) ctx.setShadow = function (ox, oy, blur, color) {
    this.shadowOffsetX = ox || 0;
    this.shadowOffsetY = oy || 0;
    this.shadowBlur = blur || 0;
    this.shadowColor = color || 'transparent';
  };

  // 旧式 draw(reserve)：标准 canvas 立即绘制，无需操作
  if (!ctx.draw) ctx.draw = function () {};

  ctx.__kroAdapted = true;
  return ctx;
}

module.exports = { adapt };
