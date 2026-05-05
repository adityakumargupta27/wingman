
import fetch from 'node-fetch';

async function testSlug(slug, type='greenhouse') {
  const url = type === 'greenhouse' 
    ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
    : `https://api.lever.co/v0/postings/${slug}?mode=json`;
  
  const res = await fetch(url);
  if (res.ok) {
    const data = await res.json();
    const count = type === 'greenhouse' ? (data.jobs?.length || 0) : (data.length || 0);
    console.log(`${type}/${slug}: ${count} jobs`);
  } else {
    // console.log(`${type}/${slug}: FAILED (${res.status})`);
  }
}

const greenhouseSlugs = ['razorpay', 'razorpayindia', 'swiggy', 'swiggyindia', 'meesho', 'cred', 'zomato', 'zerodha', 'phonepe', 'groww', 'postman', 'browserstack'];
const leverSlugs = ['razorpay', 'swiggy', 'meesho', 'cred', 'zomato', 'unacademy', 'upstox', 'cars24', 'ola', 'oyo', 'byjus'];

async function runTests() {
  await Promise.all([
    ...greenhouseSlugs.map(s => testSlug(s, 'greenhouse')),
    ...leverSlugs.map(s => testSlug(s, 'lever'))
  ]);
}

runTests();
