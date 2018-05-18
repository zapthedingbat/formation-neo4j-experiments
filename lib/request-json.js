const httpRequest = require('http').request;
const httpsRequest = require('https').request;
const { parse } = require('url');

exports = module.exports = function requestJson(method, url, data) {
  if (!typeof url === 'string' && url.length === 0) {
    throw new Error('url must be a string');
  }

  let postData = null;
  if (data) {
    postData = typeof data === 'string' ? data : JSON.stringify(data);
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = parse(url);
    const options = {
      method,
      hostname: parsedUrl.hostname,
      path: url,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    let chunks = [];
    const request = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(options, res => {
      res
        .on('data', chunk => {
          chunks.push(chunk);
        })
        .on('end', () => {
          const responseData = Buffer.concat(chunks).toString();
          const response = JSON.parse(responseData);
          resolve(response);
        })
        .on('error', err => {
          reject(err);
        });
    });
    if (data) {
      req.write(postData);
    }
    req.end();
  });
};
