import nock from 'nock';

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});

afterAll(() => {
  nock.restore();
});
