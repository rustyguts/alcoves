import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 5 },  
    { duration: '20s', target: 20 },
    { duration: '30s', target: 100 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function() {
  let res = http.get('http://localhost:3000');
  check(res, { "status is 200": (res) => res.status === 200 });
  sleep(1);
}
