'use strict';

var _slicedToArray = (function() {
  function sliceIterator(arr, i) {
    var _arr = [];
    var _n = true;
    var _d = false;
    var _e = undefined;
    try {
      for (
        var _i = arr[Symbol.iterator](), _s;
        !(_n = (_s = _i.next()).done);
        _n = true
      ) {
        _arr.push(_s.value);
        if (i && _arr.length === i) break;
      }
    } catch (err) {
      _d = true;
      _e = err;
    } finally {
      try {
        if (!_n && _i['return']) _i['return']();
      } finally {
        if (_d) throw _e;
      }
    }
    return _arr;
  }
  return function(arr, i) {
    if (Array.isArray(arr)) {
      return arr;
    } else if (Symbol.iterator in Object(arr)) {
      return sliceIterator(arr, i);
    } else {
      throw new TypeError(
        'Invalid attempt to destructure non-iterable instance'
      );
    }
  };
})();

function _asyncToGenerator(fn) {
  return function() {
    var gen = fn.apply(this, arguments);
    return new Promise(function(resolve, reject) {
      function step(key, arg) {
        try {
          var info = gen[key](arg);
          var value = info.value;
        } catch (error) {
          reject(error);
          return;
        }
        if (info.done) {
          resolve(value);
        } else {
          return Promise.resolve(value).then(
            function(value) {
              step('next', value);
            },
            function(err) {
              step('throw', err);
            }
          );
        }
      }
      return step('next');
    });
  };
}

const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');
const Resolver = require('../Resolver');
const fs = require('../utils/fs');
const os = require('os');

const IMPORT_RE = /^# *import +['"](.*)['"] *;? *$/;

class GraphqlAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';

    this.gqlMap = new Map();
    this.gqlResolver = new Resolver(
      Object.assign({}, this.options, {
        extensions: ['.gql', '.graphql']
      })
    );
  }

  traverseImports(name, code) {
    var _this = this;

    return _asyncToGenerator(function*() {
      _this.gqlMap.set(name, code);

      yield Promise.all(
        code
          .split(/\r\n?|\n/)
          .map(function(line) {
            return line.match(IMPORT_RE);
          })
          .filter(function(match) {
            return !!match;
          })
          .map(
            (() => {
              var _ref = _asyncToGenerator(function*([, importName]) {
                var _ref2 = yield _this.gqlResolver.resolve(importName, name);

                let resolved = _ref2.path;

                if (_this.gqlMap.has(resolved)) {
                  return;
                }

                let code = yield fs.readFile(resolved, 'utf8');
                yield _this.traverseImports(resolved, code);
              });

              return function(_x) {
                return _ref.apply(this, arguments);
              };
            })()
          )
      );
    })();
  }

  collectDependencies() {
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (
        var _iterator = this.gqlMap[Symbol.iterator](), _step;
        !(_iteratorNormalCompletion = (_step = _iterator.next()).done);
        _iteratorNormalCompletion = true
      ) {
        let _ref3 = _step.value;

        var _ref4 = _slicedToArray(_ref3, 1);

        let path = _ref4[0];

        this.addDependency(path, {includedInParent: true});
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }
  }

  parse(code) {
    var _this2 = this;

    return _asyncToGenerator(function*() {
      let gql = yield localRequire('graphql-tag', _this2.name);

      yield _this2.traverseImports(_this2.name, code);

      const allCodes = [..._this2.gqlMap.values()].join(os.EOL);

      return gql(allCodes);
    })();
  }

  generate() {
    return `module.exports=${JSON.stringify(this.ast, false, 2)};`;
  }
}

module.exports = GraphqlAsset;
