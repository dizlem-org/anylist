const {randomUUID} = require('node:crypto');

module.exports = () => randomUUID().replace(/-/g, '');
