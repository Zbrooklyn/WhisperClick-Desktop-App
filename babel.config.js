// Babel config for Jest — allows top-level `return` in CJS modules (main.js)
module.exports = {
  sourceType: 'script',
  parserOpts: {
    allowReturnOutsideFunction: true,
  },
};
