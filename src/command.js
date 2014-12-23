var jsDo = require('./jsdo.js');
var spawn = require('./spawn.js');
var fs = require('fs');
var path = require('path');
var buffer = require('buffer');
var stream = require('stream');
var toArray = require('./utils.js').toArray;
var extend = require('./utils.js').extend;

module.exports = function command() {
	var baseArgs = toArray(arguments);
	var nextOptions = {};

	function spawnHelper(args, options) {
		var opts = extend(nextOptions, options);
		nextOptions = {};
		return spawn.spawn(baseArgs.concat(args), opts);
	}

	var runner = function() {
		return spawnHelper(toArray(arguments));
	};

	runner.run = runner; //e.g. silent()('ls') === silent().run('ls');

	runner.silent = function() {
		nextOptions.silent = true;
		return runner;
	};

	runner.get = function() {
		var buffer = "";
		spawnHelper(toArray(arguments), {
			onOut : function(data) {
				buffer += data.toString();
			}
		});
		return buffer;
	};

	function outputToFile(flags) {
		var args = toArray(arguments);
		var mode = args.shift();
		var target = args.pop();
		var filename = path.join(jsDo.cwd(), target); //TODO: expand target!
		if (jsDo.verbose())
			console.log((flags == 'w' ? '>' : '>>') + ' filename');
		var fd = fs.openSync(filename, flags);
		try {
			return spawnHelper(args, { stdout : fd });
		} finally {
			fs.closeSync(fd);
		}
	}

	runner.writeTo = outputToFile.bind(null, 'w');
	runner.appendTo = outputToFile.bind(null, 'a');

	runner.pipe = function() {
		var child = spawnHelper(toArray(arguments), {
			blocking: false,
			throwOnError: false
		});
		return command().stdout; //returns a new empty command for immediate follow up
	};

	runner.input = function(input) {
		if (input instanceof stream.Readable)
			nextOptions.stdin = input;
		else { //string or buffer
			// http://stackoverflow.com/questions/16038705/how-to-wrap-a-buffer-as-a-stream2-readable-stream#16039177
			var bufferStream = new stream.Readable();
			bufferStream._read = function noop() {};
			bufferStream.push(input);
			bufferStream.push(null);
			nextOptions.stdin = bufferStream;
		}
		return this;
	};

	runner.inputFile = function(source) {
		var filename = path.join(jsDo.cwd(), source); //TODO: expand source!
		if (jsDo.verbose())
			console.log('< ' + filename);
		nextOptions.stdin = fs.openSync(filename, 'r');
		return runner;
	};

	runner.code = function() {
		return spawnHelper(toArray(arguments), {
			throwOnError : false
		});
	};

	runner.test = function() {
		return this.code.apply(this, arguments) === 0;
	};

	runner.detach = function() {
		var child = spawnHelper(toArray(arguments), {
			blocking: false,
			throwOnError: false,
			detached: true
		});
		child.unref(); //do not wait for child to exit
		console.log("[+] " + child.pid);
		return child.pid;
	};

	return runner;
};