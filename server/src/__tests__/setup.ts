import nock from 'nock';

// Allow local loopback connections for supertest while blocking external networks
beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});

afterAll(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});
