const http = require('http');
const User = require('../src/models/User');

const REGULAR_USER_ID = User.findByUsername('zhangsan').id;
const ADMIN_USER_ID = User.findByUsername('admin').id;

console.log('Regular user ID:', REGULAR_USER_ID);
console.log('Admin user ID:', ADMIN_USER_ID);

function makeRequest(options, body = null, userId) {
  const headers = options.headers || {};
  headers['x-user-id'] = userId;
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  options.headers = headers;
  
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test() {
  console.log('\n--- Testing export with regular user ---');
  const res1 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  }, null, REGULAR_USER_ID);
  console.log('Status:', res1.status);
  console.log('Data:', res1.data);

  console.log('\n--- Testing export with admin user ---');
  const res2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/rules/export',
    method: 'GET'
  }, null, ADMIN_USER_ID);
  console.log('Status:', res2.status);
  console.log('Data keys:', Object.keys(res2.data));
  console.log('Rule count:', res2.data.rules?.length);
}

test().catch(err => console.error(err));
