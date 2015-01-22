var shell = require('./shell.js');
var spawn = require('./spawn.js');
var fs = require('fs');
var path = require('path');
var buffer = require('buffer');
var stream = require('stream');
var toArray = require('./utils.js').toArray;
var extend = require('./utils.js').extend;
var Future = require('fibers/future');

var command = module.exports = function() {
	//TODO: utils.assertArgsCount(0,1,..)

	/*
		Basic command structure
	 */
	var baseArgs = toArray(arguments);
	var nextOptions = {};

	var cmd = function(/* args */) {
		return cmd.spawn.apply(null, arguments).wait();
	};

	cmd.boundArgs = baseArgs;
	cmd.run = cmd; //e.g. silent()('ls') === silent().run('ls');

	/*
		Options and convenience methods
	 */
	cmd.silent = function() {
		nextOptions.silent = true;
		return cmd;
	};

	cmd.relax = function() {
		nextOptions.throwOnError = false;
		return cmd;
	};

	cmd.code = function(/* args */) {
		return cmd.spawn.apply(null, arguments).code();
	};

	cmd.test = function(/* args */) {
		return cmd.spawn.apply(null, arguments).test();
	};

	cmd.get = function(/* args */) {
		return cmd.spawn.apply(null, arguments).get();
	};
	//TODO: getLines, getAll


	/*
		Process input handling
	 */
	cmd.input = function(input) {
		if (nextOptions.stdin)
			throw "Input for the next process invocation has been set already!";
		if (typeof(input) == "number" || (input && input.pipe)) {
			nextOptions.stdin = input;
		}
		//TODO: if function, evaluate lazy on each read, so that 'yes' script
		else { //string or buffer
			// http://stackoverflow.com/questions/16038705/how-to-wrap-a-buffer-as-a-stream2-readable-stream#16039177
			var bufferStream = new stream.Readable();
			bufferStream._read = function () {
				this.push('' + input + '\n'); //TODO: probably remove the \n
				this.push(null);
			};
			nextOptions.stdin = bufferStream;
		}
		return cmd;
	};

	cmd.read = function(filename) {
		if (nextOptions.stdin)
			throw "Input for the next process invocation has been set already!";
		filename = spawn.expandArgument(filename, false);
		if (shell.verbose())
			console.warn('< ' + filename);
		nextOptions.stdin = fs.openSync(filename, 'r');
		return cmd;
	};

	/*
		Process output handling
	 */

	cmd.pipe = function(/* args */) {
		return cmd.spawn().pipe.apply(null, arguments);
	};

	cmd.write = function(filename) {
		// returns exit code
		return cmd.spawn().write(filename).wait();
	};

	cmd.append = function(filename) {
		// returns exit code
		return cmd.spawn().append(filename).wait();
	};

	cmd.writeError = function(filename) {
		// returns streams for convenient chaining
		return cmd.spawn().writeError(filename);
	};

	cmd.appendError = function(filename) {
		// returns streams for convenient chaining
		return cmd.spawn().appendError(filename);
	};

	cmd.spawn = function(/*args*/) {
		var streamsConsumed = [null, false, false];
		var self = {};
		var options = extend({
			throwOnError: false,
			silent: false
		}, nextOptions);
		nextOptions = {};

		var child = spawn.spawn(baseArgs.concat(toArray(arguments)), options);
		process.nextTick(function() {
			//make sure the output streams go somewhere
			for(var i = 1; i < 3; i++) if (!streamsConsumed[i]) {
				if (options.silent)
					child.stdio[i].resume();
				else {
					child.stdio[i].pipe(i == 1 ? process.stdout : process.stderr);
					child.stdio[i].isTTY = process.stdout.isTTY;  //TODO: needed, more ...  fix rawMode if repl?
				}
			}
		});

		function outputToFile(streamIdx, flags, filename) {
			streamsConsumed[streamIdx] = true;
			if (shell.verbose())
				console.warn((streamIdx == 2 ? '2' : '') + (flags == 'w' ? '>' : '>>') + ' ' + filename);
			var out = fs.createWriteStream(filename,  {flags: flags});
			child.stdio[streamIdx].pipe(out);
			return self;
		}

		function pipeHelper(streamIdx, cmd) {
			streamsConsumed[streamIdx] = true;
			if (!cmd.boundArgs)
				cmd = command(cmd);
			// Set the input of the target command to the output of this command
			// And start the command, and return the streams
			return cmd.input(child.stdio[streamIdx]).spawn.apply(cmd, toArray(arguments).splice(2));
		}

		function getHelper(streamIdx) {
			var buf = "";
			child.stdio[streamIdx].on('data', function(d) {
				buf += d;
			});
			self.wait();
			return buf;
		}

		return extend(self, {
			process : child,
			get: getHelper.bind(self, 1),
			getError: getHelper.bind(self, 2),
			pipe: pipeHelper.bind(self, 1),
			pipeError: pipeHelper.bind(self, 2),
			write: outputToFile.bind(self, 1,'w'),
			append: outputToFile.bind(self, 1,'a'),
			writeError: outputToFile.bind(self, 2,'w'),
			appendError: outputToFile.bind(self, 2,'a'),
			wait: function() {
				var future = new Future();
				var spawnError;

				child.on('error', function(err) {
					spawnError = err;
				});
				child.on('close', function(exitCode) {
					future.return(exitCode);
				});
				var status = shell.lastExitCode = future.wait();
				if (status !== 0 && options.throwOnError)
					throw new Error({code: status, msg: "Command '" + command + "' failed with status: " + status});
				return status;
			},
			test: function() { return self.code() === 0; },
			code: function() {
				options.throwOnError = false;
				return self.wait();
			},
			onClose: function(cb) {
				child.on('close', cb);
			},
			onOut: function(cb) {
				child.stdout.on('data', cb);
			},
			toString: function() {
				return "[OutputStreams of " + args + "]";
			}
		});
	};

	cmd.detach = function(/* args */) {
		nextOptions.detached = true;
		var child = cmd.spawn.apply(null, arguments).process;
		child.unref(); //do not wait for child to exit
		console.warn("[+] " + child.pid);
		return child.pid;
	};

	cmd.toString = function() {
		return "[Command " + this.boundArgs.join(" ") + "]";
	};

	//FEATURE: cmd.background: run stuff in background, but kill it when the process exits
	return cmd;
};