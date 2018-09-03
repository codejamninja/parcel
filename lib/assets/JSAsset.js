'use strict';

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

const babelCore = require('@babel/core');
const traverse = require('@babel/traverse').default;
const codeFrame = require('@babel/code-frame').codeFrameColumns;
const collectDependencies = require('../visitors/dependencies');
const walk = require('babylon-walk');
const Asset = require('../Asset');
// const babylon = require('@babel/parser');
const insertGlobals = require('../visitors/globals');
const fsVisitor = require('../visitors/fs');
const envVisitor = require('../visitors/env');
const babel = require('../transforms/babel');
const generate = require('@babel/generator').default;
const terser = require('../transforms/terser');
const SourceMap = require('../SourceMap');
const hoist = require('../scope-hoisting/hoist');
const path = require('path');
const fs = require('../utils/fs');
const logger = require('../Logger');

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const ENV_RE = /\b(?:process\.env)\b/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer|define)\b/;
const FS_RE = /\breadFileSync\b/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*(?:Shared)?Worker\s*\(/;
const SOURCEMAP_RE = /\/\/\s*[@#]\s*sourceMappingURL\s*=\s*([^\s]+)/;
const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

class JSAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
    this.globals = new Map();
    this.isAstDirty = false;
    this.isES6Module = false;
    this.outputCode = null;
    this.cacheData.env = {};
    this.rendition = options.rendition;
    this.sourceMap = this.rendition ? this.rendition.sourceMap : null;
  }

  shouldInvalidate(cacheData) {
    for (let key in cacheData.env) {
      if (cacheData.env[key] !== process.env[key]) {
        return true;
      }
    }

    return false;
  }

  mightHaveDependencies() {
    return (
      this.isAstDirty ||
      !/.js$/.test(this.name) ||
      IMPORT_RE.test(this.contents) ||
      GLOBAL_RE.test(this.contents) ||
      SW_RE.test(this.contents) ||
      WORKER_RE.test(this.contents)
    );
  }

  getParserOptions() {
    var _this = this;

    return _asyncToGenerator(function*() {
      // Babylon options. We enable a few plugins by default.
      const options = {
        parserOpts: {
          filename: _this.name,
          allowReturnOutsideFunction: true,
          allowHashBang: true,
          ecmaVersion: Infinity,
          strictMode: false,
          sourceType: 'module',
          locations: true,
          plugins: ['exportExtensions', 'dynamicImport']
        }
      };

      // Check if there is a babel config file. If so, determine which parser plugins to enable
      _this.babelConfig = yield babel.getConfig(_this);
      Object.assign(options, _this.babelConfig);
      // if (this.babelConfig) {
      //   const file = new BabelFile(this.babelConfig);
      //   options.plugins.push(...file.parserOpts.plugins);
      // }

      return options;
    })();
  }

  parse(code) {
    var _this2 = this;

    return _asyncToGenerator(function*() {
      const options = yield _this2.getParserOptions();
      // return babylon.parse(code, options);
      return babelCore.parse(code, options);
    })();
  }

  traverse(visitor) {
    // Create a babel File object if one hasn't been created yet.
    // This is needed so that cached NodePath objects get a `hub` object on them.
    // Plugins like babel-minify depend on this to get the original source code string.
    // if (!this.babelFile) {
    //   this.babelFile = new BabelFile(this.babelConfig || {});
    //   this.babelFile.addCode(this.contents);
    //   this.babelFile.addAst(this.ast);
    // }

    return traverse(this.ast, visitor, null, this);
  }

  traverseFast(visitor) {
    return walk.simple(this.ast, visitor, this);
  }

  collectDependencies() {
    walk.ancestor(this.ast, collectDependencies, this);
  }

  loadSourceMap() {
    var _this3 = this;

    return _asyncToGenerator(function*() {
      // Get original sourcemap if there is any
      let match = _this3.contents.match(SOURCEMAP_RE);
      if (match) {
        _this3.contents = _this3.contents.replace(SOURCEMAP_RE, '');

        let url = match[1];
        let dataURLMatch = url.match(DATA_URL_RE);

        try {
          let json, filename;
          if (dataURLMatch) {
            filename = _this3.name;
            json = new Buffer(dataURLMatch[1], 'base64').toString();
          } else {
            filename = path.join(path.dirname(_this3.name), url);
            json = yield fs.readFile(filename, 'utf8');

            // Add as a dep so we watch the source map for changes.
            _this3.addDependency(filename, {includedInParent: true});
          }

          _this3.sourceMap = JSON.parse(json);

          // Attempt to read missing source contents
          if (!_this3.sourceMap.sourcesContent) {
            _this3.sourceMap.sourcesContent = [];
          }

          let missingSources = _this3.sourceMap.sources.slice(
            _this3.sourceMap.sourcesContent.length
          );
          if (missingSources.length) {
            let contents = yield Promise.all(
              missingSources.map(
                (() => {
                  var _ref = _asyncToGenerator(function*(source) {
                    try {
                      let sourceFile = path.join(
                        path.dirname(filename),
                        _this3.sourceMap.sourceRoot || '',
                        source
                      );
                      let result = yield fs.readFile(sourceFile, 'utf8');
                      _this3.addDependency(sourceFile, {
                        includedInParent: true
                      });
                      return result;
                    } catch (err) {
                      logger.warn(
                        `Could not load source file "${source}" in source map of "${
                          _this3.relativeName
                        }".`
                      );
                    }
                  });

                  return function(_x) {
                    return _ref.apply(this, arguments);
                  };
                })()
              )
            );

            _this3.sourceMap.sourcesContent = _this3.sourceMap.sourcesContent.concat(
              contents
            );
          }
        } catch (e) {
          logger.warn(
            `Could not load existing sourcemap of "${_this3.relativeName}".`
          );
        }
      }
    })();
  }

  pretransform() {
    var _this4 = this;

    return _asyncToGenerator(function*() {
      yield _this4.loadSourceMap();
      yield babel(_this4);

      // Inline environment variables
      if (_this4.options.target === 'browser' && ENV_RE.test(_this4.contents)) {
        yield _this4.parseIfNeeded();
        _this4.traverseFast(envVisitor);
      }
    })();
  }

  transform() {
    var _this5 = this;

    return _asyncToGenerator(function*() {
      if (_this5.options.target === 'browser') {
        if (_this5.dependencies.has('fs') && FS_RE.test(_this5.contents)) {
          // Check if we should ignore fs calls
          // See https://github.com/defunctzombie/node-browser-resolve#skip
          let pkg = yield _this5.getPackage();
          let ignore = pkg && pkg.browser && pkg.browser.fs === false;

          if (!ignore) {
            yield _this5.parseIfNeeded();
            _this5.traverse(fsVisitor);
          }
        }

        if (GLOBAL_RE.test(_this5.contents)) {
          yield _this5.parseIfNeeded();
          walk.ancestor(_this5.ast, insertGlobals, _this5);
        }
      }

      if (_this5.options.scopeHoist) {
        yield _this5.parseIfNeeded();
        yield _this5.getPackage();

        _this5.traverse(hoist);
        _this5.isAstDirty = true;
      } else {
        if (_this5.isES6Module) {
          yield babel(_this5);
        }
      }

      if (_this5.options.minify) {
        yield terser(_this5);
      }
    })();
  }

  generate() {
    var _this6 = this;

    return _asyncToGenerator(function*() {
      let enableSourceMaps =
        _this6.options.sourceMaps &&
        (!_this6.rendition || !!_this6.rendition.sourceMap);
      let code;
      if (_this6.isAstDirty) {
        let opts = {
          sourceMaps: _this6.options.sourceMaps,
          sourceFileName: _this6.relativeName
        };

        let generated = generate(_this6.ast, opts, _this6.contents);

        if (enableSourceMaps && generated.rawMappings) {
          let rawMap = new SourceMap(generated.rawMappings, {
            [_this6.relativeName]: _this6.contents
          });

          // Check if we already have a source map (e.g. from TypeScript or CoffeeScript)
          // In that case, we need to map the original source map to the babel generated one.
          if (_this6.sourceMap) {
            _this6.sourceMap = yield new SourceMap().extendSourceMap(
              _this6.sourceMap,
              rawMap
            );
          } else {
            _this6.sourceMap = rawMap;
          }
        }

        code = generated.code;
      } else {
        code = _this6.outputCode != null ? _this6.outputCode : _this6.contents;
      }

      if (enableSourceMaps && !_this6.sourceMap) {
        _this6.sourceMap = new SourceMap().generateEmptyMap(
          _this6.relativeName,
          _this6.contents
        );
      }

      if (_this6.globals.size > 0) {
        code = Array.from(_this6.globals.values()).join('\n') + '\n' + code;
        if (enableSourceMaps) {
          if (!(_this6.sourceMap instanceof SourceMap)) {
            _this6.sourceMap = yield new SourceMap().addMap(_this6.sourceMap);
          }

          _this6.sourceMap.offset(_this6.globals.size);
        }
      }

      return {
        js: code,
        map: _this6.sourceMap
      };
    })();
  }

  generateErrorMessage(err) {
    const loc = err.loc;
    if (loc) {
      err.codeFrame = codeFrame(this.contents, {start: loc});
      err.highlightedCodeFrame = codeFrame(
        this.contents,
        {start: loc},
        {highlightCode: true}
      );
    }

    return err;
  }
}

module.exports = JSAsset;
