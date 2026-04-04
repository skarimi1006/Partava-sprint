'use strict';

const routes = require('./routes');

module.exports = {
  register(router, db) {
    routes.register(router, db);
  }
};
