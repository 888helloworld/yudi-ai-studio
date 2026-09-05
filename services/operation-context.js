const { AsyncLocalStorage } = require('node:async_hooks');

// 每个收费 HTTP 请求独立保存上下文，异步请求之间不会串账。
module.exports = new AsyncLocalStorage();
