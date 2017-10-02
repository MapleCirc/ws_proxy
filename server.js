#!/usr/bin/env node
const spawn = require('child_process').spawn;
const websocketServer = require('websocket').server;
const http = require('http');
const struct = require('c-struct');
const ctype = struct.type;

const httpServer = http.createServer(function (request, response) {
	response.writeHead(403);
	response.end();
});
httpServer.listen(5566, '127.0.0.1', function () {
	console.log(`[${new Date()}] HTTP server is listening on port 127.0.0.1:5566`);
});

const wsServer = new websocketServer({
	httpServer: httpServer,
	autoAcceptConnections: false
});

function originIsAllowed(origin) {
	return true;
}

function bbsdSetTimeout(handle, callback) {
	if (handle) clearTimeout(handle);
	return setTimeout(callback, 30 * 60 * 1000);
}

struct.register('proxyPayload', new struct.Schema({
	connect_port: ctype.uint16,
	__reserved: ctype.u16(0),
	source_addr: ctype.uint32
}));

function buildProxyPayload(request) {
	let remoteAddress = request.remoteAddress
		.split('.')
		.map(function (str) { return parseInt(str, 10); })
		.reverse()
		.reduce(function (reduced, val) {
			return (reduced << 8) | val;
		}, 0);

	return struct.packSync('proxyPayload', {
		connect_port: 0x5566,
		source_addr: remoteAddress
	});
}

wsServer.on('request', function (request) {
	if (!originIsAllowed(request.origin)) {
		request.reject();
		return;
	}

	let connection = request.accept(null, request.origin);
	console.log(`[${new Date()}] ${request.remoteAddress} Connection accepted.`);
	let bbsd = spawn('/home/bbs/bin/bbsd', ['-p'], {
		cwd: '/home/bbs'
	});
	let bbsdPipe = bbsd.stdio[0];
	bbsdPipe.write(buildProxyPayload(request));

	connection.on('message', function (message) {
		if ('binary' == message.type) {
			bbsdPipe.write(message.binaryData);
		}
	});
	connection.on('close', function () {
		bbsdPipe.end();
		connection.close(1000, 'bye');
		console.log(`[${new Date()}] ${request.remoteAddress} Close connection.`);
	});

	let bbsdLostHandler = function () {
		connection.close(1000, 'bbs died');
		console.log(`[${new Date()}] ${request.remoteAddress} BBS died.`);
	};

	let bbsdTimeout = bbsdSetTimeout(null, bbsdLostHandler);
	bbsdPipe.on('error', function (e) {
		bbsdPipe.end();
		bbsdLostHandler();
	});
	bbsdPipe.on('data', function (data) {
		bbsdTimeout = bbsdSetTimeout(bbsdTimeout, bbsdLostHandler);
		connection.sendBytes(data);
	});
});
