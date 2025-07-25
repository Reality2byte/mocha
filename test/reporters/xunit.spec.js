'use strict';

var EventEmitter = require('node:events').EventEmitter;
var fs = require('node:fs');
var path = require('node:path');
var sinon = require('sinon');
var createStatsCollector = require('../../lib/stats-collector');
var events = require('../../').Runner.constants;
var reporters = require('../../').reporters;
var states = require('../../').Runnable.constants;

const {createTempDir, touchFile} = require('../integration/helpers');

var Base = reporters.Base;
var XUnit = reporters.XUnit;

var EVENT_RUN_END = events.EVENT_RUN_END;
var EVENT_TEST_END = events.EVENT_TEST_END;
var EVENT_TEST_FAIL = events.EVENT_TEST_FAIL;
var EVENT_TEST_PASS = events.EVENT_TEST_PASS;
var EVENT_TEST_PENDING = events.EVENT_TEST_PENDING;

var STATE_FAILED = states.STATE_FAILED;
var STATE_PASSED = states.STATE_PASSED;

describe('XUnit reporter', function () {
  var runner;
  var noop = function () {};

  var expectedLine = 'some-line';
  var expectedClassName = 'fullTitle';
  var expectedTitle = 'some title';
  var expectedFile = 'testFile.spec.js';
  var expectedMessage = 'some message';
  var expectedDiff =
    '\n      + expected - actual\n\n      -foo\n      +bar\n      ';
  var expectedStack = 'some-stack';

  beforeEach(function () {
    runner = {on: noop, once: noop};
    createStatsCollector(runner);
  });

  describe("when 'reporterOptions.output' is provided", function () {
    var expectedOutput = path.join(path.sep, 'path', 'to', 'some-output');
    var options = {
      reporterOptions: {
        output: expectedOutput
      }
    };

    describe('when fileStream can be created', function () {
      var fsMkdirSync;
      var fsCreateWriteStream;

      beforeEach(function () {
        fsMkdirSync = sinon.stub(fs, 'mkdirSync');
        fsCreateWriteStream = sinon.stub(fs, 'createWriteStream');
      });

      it('should open given file for writing, recursively creating directories in pathname', function () {
        var fakeThis = {
          fileStream: null
        };
        XUnit.call(fakeThis, runner, options);

        var expectedDirectory = path.dirname(expectedOutput);
        expect(
          fsMkdirSync.calledWith(expectedDirectory, {
            recursive: true
          }),
          'to be true'
        );

        expect(fsCreateWriteStream.calledWith(expectedOutput), 'to be true');
      });

      afterEach(function () {
        sinon.restore();
      });
    });

    describe('when fileStream cannot be created', function () {
      describe('when given an invalid pathname', function () {
        /**
         * @type {string}
         */
        let tmpdir;

        /**
         * @type {import('../integration/helpers').RemoveTempDirCallback}
         */
        let cleanup;
        var invalidPath;

        beforeEach(async function () {
          const {dirpath, removeTempDir} = await createTempDir();
          tmpdir = dirpath;
          cleanup = removeTempDir;

          // Create path where file 'some-file' used as directory
          invalidPath = path.join(
            tmpdir,
            'some-file',
            path.basename(expectedOutput)
          );
          touchFile(path.dirname(invalidPath));
        });

        it('should throw system error', function () {
          var options = {
            reporterOptions: {
              output: invalidPath
            }
          };
          var boundXUnit = XUnit.bind({}, runner, options);
          expect(
            boundXUnit,
            'to throw',
            expect.it('to be an', Error).and('to satisfy', {
              syscall: 'mkdir',
              code: 'EEXIST',
              path: path.dirname(invalidPath)
            })
          );
        });

        afterEach(function () {
          cleanup();
        });
      });

      describe('when run in browser', function () {
        beforeEach(function () {
          sinon.stub(fs, 'createWriteStream').value(false);
        });

        it('should throw unsupported error', function () {
          var boundXUnit = XUnit.bind({}, runner, options);
          expect(
            boundXUnit,
            'to throw',
            'file output not supported in browser'
          );
        });

        afterEach(function () {
          sinon.restore();
        });
      });
    });
  });

  describe('event handlers', function () {
    describe("on 'pending', 'pass' and 'fail' events", function () {
      it("should add test to tests called on 'end' event", function () {
        var pendingTest = {
          name: 'pending',
          slow: noop
        };
        var failTest = {
          name: 'fail',
          slow: noop
        };
        var passTest = {
          name: 'pass',
          slow: noop
        };
        runner.on = runner.once = function (event, callback) {
          if (event === EVENT_TEST_PENDING) {
            callback(pendingTest);
          } else if (event === EVENT_TEST_PASS) {
            callback(passTest);
          } else if (event === EVENT_TEST_FAIL) {
            callback(failTest);
          } else if (event === EVENT_RUN_END) {
            callback();
          }
        };

        var calledTests = [];
        var fakeThis = {
          write: noop,
          test: function (test) {
            calledTests.push(test);
          }
        };
        XUnit.call(fakeThis, runner);

        var expectedCalledTests = [pendingTest, passTest, failTest];
        expect(calledTests, 'to equal', expectedCalledTests);
      });
    });
  });

  describe('#done', function () {
    var xunit;
    var options = {
      reporterOptions: {}
    };
    var expectedNFailures = 13;
    var callback;

    beforeEach(function () {
      callback = sinon.spy();
    });

    afterEach(function () {
      callback = null;
      xunit = null;
      sinon.restore();
    });

    describe('when output directed to file', function () {
      var fakeThis;

      beforeEach(function () {
        xunit = new XUnit(runner, options);

        fakeThis = {
          fileStream: {
            end: sinon.stub().callsFake(function (chunk, encoding, cb) {
              if (typeof arguments[0] === 'function') {
                cb = arguments[0];
              }
              cb();
            }),
            write: function () {}
          }
        };
      });

      it("should run completion callback via 'fileStream.end'", function () {
        xunit.done.call(fakeThis, expectedNFailures, callback);

        expect(fakeThis.fileStream.end.calledOnce, 'to be true');
        expect(callback.calledOnce, 'to be true');
        expect(callback.calledWith(expectedNFailures), 'to be true');
      });
    });

    describe('when output directed to stdout (or console)', function () {
      var fakeThis;

      beforeEach(function () {
        xunit = new XUnit(runner, options);
        fakeThis = {};
      });

      it('should run completion callback', function () {
        xunit.done.call(fakeThis, expectedNFailures, callback);

        expect(callback.calledOnce, 'to be true');
        expect(callback.calledWith(expectedNFailures), 'to be true');
      });
    });
  });

  describe('#write', function () {
    // :TODO: Method should be named 'writeln', not 'write'
    describe('when output directed to file', function () {
      var fileStream = {
        write: sinon.spy()
      };

      it("should call 'fileStream.write' with line and newline", function () {
        var xunit = new XUnit(runner);
        var fakeThis = {fileStream};
        xunit.write.call(fakeThis, expectedLine);

        expect(fileStream.write.calledWith(expectedLine + '\n'), 'to be true');
      });
    });

    describe('when output directed to stdout', function () {
      it("should call 'process.stdout.write' with line and newline", function () {
        var xunit = new XUnit(runner);
        var fakeThis = {fileStream: false};
        var stdoutWriteStub = sinon.stub(process.stdout, 'write');
        xunit.write.call(fakeThis, expectedLine);
        stdoutWriteStub.restore();

        expect(stdoutWriteStub.calledWith(expectedLine + '\n'), 'to be true');
      });
    });

    describe('when output directed to console', function () {
      it("should call 'Base.consoleLog' with line", function () {
        // :TODO: XUnit needs a trivially testable means to force console.log()
        var realProcess = process;
        process = false; // eslint-disable-line no-native-reassign, no-global-assign

        var xunit = new XUnit(runner);
        var fakeThis = {fileStream: false};
        var consoleLogStub = sinon.stub(Base, 'consoleLog');
        xunit.write.call(fakeThis, expectedLine);
        consoleLogStub.restore();

        process = realProcess; // eslint-disable-line no-native-reassign, no-global-assign

        expect(consoleLogStub.calledWith(expectedLine), 'to be true');
      });
    });
  });

  describe('#test', function () {
    var expectedWrite;
    var fakeThis = {
      write: function (str) {
        expectedWrite = str;
      }
    };

    beforeEach(function () {
      sinon.stub(Base, 'useColors').value(false);
    });

    afterEach(function () {
      sinon.restore();
      expectedWrite = null;
    });

    describe('on test failure', function () {
      it('should write expected tag with error details', function () {
        var xunit = new XUnit(runner);
        var expectedTest = {
          state: STATE_FAILED,
          title: expectedTitle,
          file: expectedFile,
          parent: {
            fullTitle: function () {
              return expectedClassName;
            }
          },
          duration: 1000,
          err: {
            actual: 'foo',
            expected: 'bar',
            message: expectedMessage,
            stack: expectedStack
          }
        };

        xunit.test.call(fakeThis, expectedTest);
        sinon.restore();

        var expectedTag =
          '<testcase classname="' +
          expectedClassName +
          '" name="' +
          expectedTitle +
          '" file="' +
          expectedFile +
          '" time="1"><failure>' +
          expectedMessage +
          '\n' +
          expectedDiff +
          '\n' +
          expectedStack +
          '</failure></testcase>';
        expect(expectedWrite, 'to be', expectedTag);
      });

      it('should handle non-string diff values', function () {
        var runner = new EventEmitter();
        createStatsCollector(runner);
        var xunit = new XUnit(runner);

        var expectedTest = {
          state: STATE_FAILED,
          title: expectedTitle,
          file: expectedFile,
          parent: {
            fullTitle: function () {
              return expectedClassName;
            }
          },
          duration: 1000,
          err: {
            actual: 1,
            expected: 2,
            message: expectedMessage,
            stack: expectedStack
          }
        };

        sinon.stub(xunit, 'write').callsFake(function (str) {
          expectedWrite += str;
        });

        runner.emit(EVENT_TEST_FAIL, expectedTest, expectedTest.err);
        runner.emit(EVENT_RUN_END);
        sinon.restore();

        var expectedDiff =
          '\n      + expected - actual\n\n      -1\n      +2\n      ';

        expect(expectedWrite, 'to contain', expectedDiff);
      });
    });

    describe('on test pending', function () {
      it('should write expected tag', function () {
        var xunit = new XUnit(runner);
        var expectedTest = {
          isPending: function () {
            return true;
          },
          title: expectedTitle,
          file: expectedFile,
          parent: {
            fullTitle: function () {
              return expectedClassName;
            }
          },
          duration: 1000
        };

        xunit.test.call(fakeThis, expectedTest);
        sinon.restore();

        var expectedTag =
          '<testcase classname="' +
          expectedClassName +
          '" name="' +
          expectedTitle +
          '" file="' +
          expectedFile +
          '" time="1"><skipped/></testcase>';
        expect(expectedWrite, 'to be', expectedTag);
      });
    });

    describe('on test in any other state', function () {
      it('should write expected tag', function () {
        var xunit = new XUnit(runner);
        var expectedTest = {
          isPending: function () {
            return false;
          },
          title: expectedTitle,
          file: expectedFile,
          parent: {
            fullTitle: function () {
              return expectedClassName;
            }
          },
          duration: false
        };

        xunit.test.call(fakeThis, expectedTest);
        sinon.restore();

        var expectedTag =
          '<testcase classname="' +
          expectedClassName +
          '" name="' +
          expectedTitle +
          '" file="' +
          expectedFile +
          '" time="0"/>';
        expect(expectedWrite, 'to be', expectedTag);
      });
    });

    it('should write expected summary statistics', function () {
      var numTests = 0;
      var numPass = 0;
      var numFail = 0;
      var simpleError = {
        actual: 'foo',
        expected: 'bar',
        message: expectedMessage,
        stack: expectedStack
      };
      var generateTest = function (passed) {
        numTests++;
        if (passed) {
          numPass++;
        } else {
          numFail++;
        }
        return {
          title: [expectedTitle, numTests].join(': '),
          state: passed ? STATE_PASSED : STATE_FAILED,
          isPending: function () {
            return false;
          },
          slow: function () {
            return false;
          },
          parent: {
            fullTitle: function () {
              return expectedClassName;
            }
          },
          duration: 1000
        };
      };

      var runner = new EventEmitter();
      createStatsCollector(runner);
      var xunit = new XUnit(runner);
      expectedWrite = '';
      sinon.stub(xunit, 'write').callsFake(function (str) {
        expectedWrite += str;
      });

      // 3 tests, no failures (i.e. tests that could not run), and 2 errors
      runner.emit(EVENT_TEST_PASS, generateTest(true));
      runner.emit(EVENT_TEST_END);
      runner.emit(EVENT_TEST_FAIL, generateTest(false), simpleError);
      runner.emit(EVENT_TEST_END);
      runner.emit(EVENT_TEST_FAIL, generateTest(false), simpleError);
      runner.emit(EVENT_TEST_END);
      runner.emit(EVENT_RUN_END);

      sinon.restore();

      var expectedNumPass = 1;
      var expectedNumFail = 2;
      var expectedNumTests = 3;

      expect(expectedNumPass, 'to be', numPass);
      expect(expectedNumFail, 'to be', numFail);
      expect(expectedNumTests, 'to be', numTests);

      // :NOTE: Mocha test "fail" is an XUnit "error"
      var expectedTag =
        '<testsuite name="Mocha Tests" tests="3" failures="0" errors="2" skipped="0"';

      expect(expectedWrite, 'to contain', expectedTag);
      expect(expectedWrite, 'to contain', '</testsuite>');
    });
  });

  describe('suite name', function () {
    // Capture the events that the reporter subscribes to
    var events = {};
    // Capture output lines (will contain the resulting XML of XUnit reporter)
    var lines = [];
    // File stream into which the XUnit reporter will write
    var fileStream;

    before(function () {
      fileStream = {
        write: function (chunk) {
          lines.push(chunk);
        }
      };
    });

    beforeEach(function () {
      lines = [];
      events = {};

      runner.on = runner.once = function (eventName, eventHandler) {
        // Capture the event handler
        events[eventName] = eventHandler;
      };
    });

    it('should use custom name if provided via reporter options', function () {
      var customSuiteName = 'Mocha Is Great!';
      var options = {
        reporterOptions: {
          suiteName: customSuiteName
        }
      };

      var xunit = new XUnit(runner, options);
      xunit.fileStream = fileStream;

      // Trigger end event to force XUnit reporter to write its output
      events[EVENT_RUN_END]();

      expect(lines[0], 'to contain', customSuiteName);
    });

    it('should use default name otherwise', function () {
      var defaultSuiteName = 'Mocha Tests';
      var options = {
        reporterOptions: {}
      };

      var xunit = new XUnit(runner, options);
      xunit.fileStream = fileStream;

      // Trigger end event to force XUnit reporter to write its output
      events[EVENT_RUN_END]();

      expect(lines[0], 'to contain', defaultSuiteName);
    });
  });

  describe('showRelativePaths reporter option', function () {
    const projectPath = path.join('home', 'username', 'demo-project');
    const relativeTestPath = path.join('tests', 'demo-test.spec.js');
    const absoluteTestPath = path.join(projectPath, relativeTestPath);

    var expectedWrite = '';
    const fakeThis = {
      write: function (str) {
        expectedWrite = expectedWrite + str;
      }
    };

    const failingTest = {
      state: STATE_FAILED,
      title: expectedTitle,
      file: absoluteTestPath,
      parent: {
        fullTitle: function () {
          return expectedClassName;
        }
      },
      duration: 1000,
      err: {
        actual: 'foo',
        expected: 'bar',
        message: expectedMessage,
        stack: expectedStack
      }
    };

    beforeEach(function () {
      sinon.stub(process, 'cwd').returns(projectPath);
    });

    afterEach(function () {
      sinon.restore();
      expectedWrite = '';
    });

    it('shows relative paths for tests if showRelativePaths reporter option is set', function () {
      const options = {
        reporterOptions: {
          showRelativePaths: true
        }
      };
      const xunit = new XUnit(runner, options);

      xunit.test.call(fakeThis, failingTest, options);

      expect(expectedWrite, 'not to contain', absoluteTestPath);
      expect(expectedWrite, 'to contain', relativeTestPath);
    });

    it('shows absolute paths for tests by default', function () {
      const options = {};
      const xunit = new XUnit(runner);

      xunit.test.call(fakeThis, failingTest, options);

      expect(expectedWrite, 'to contain', absoluteTestPath);
      // Double quote included to ensure printed paths don't start with relative path. Example printed line: <testcase classname="suite" name="test" file="some/tesfile.js" time="0"/>
      expect(expectedWrite, 'not to contain', `"${relativeTestPath}`);
    });
  });
});
