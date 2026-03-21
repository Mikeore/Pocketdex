const test = require('node:test');
const assert = require('node:assert/strict');
const { BaseCodexClient, extractCodexErrorText } = require('../src/codex-client');

class FakeCodexClient extends BaseCodexClient {
  _send() {}
}

test('extractCodexErrorText prefers explicit message fields', () => {
  assert.equal(
    extractCodexErrorText({ message: 'Model switching is unavailable for this account.' }),
    'Model switching is unavailable for this account.'
  );
});

test('extractCodexErrorText humanizes structured codex error info', () => {
  assert.equal(
    extractCodexErrorText({
      codexErrorInfo: {
        responseStreamConnectionFailed: {
          httpStatusCode: 403,
        },
      },
    }),
    'Response Stream Connection Failed: HTTP 403'
  );
});

test('BaseCodexClient rejects pending requests with a concise structured error', async () => {
  const client = new FakeCodexClient('stdio');
  const pending = client.sendRequest('model/set', { model: 'gpt-5' });

  client._handleMessage({
    id: 1,
    error: {
      codexErrorInfo: {
        responseStreamConnectionFailed: {
          httpStatusCode: 403,
        },
      },
    },
  });

  await assert.rejects(pending, /Response Stream Connection Failed: HTTP 403/);
});