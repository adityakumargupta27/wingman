
import fetch from 'node-fetch';

async function testSlug(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const res = await fetch(url);
  if (res.ok) {
    const data = await res.json();
    console.log(`${slug}: ${data.jobs?.length || 0} jobs`);
  } else {
    console.log(`${slug}: FAILED (${res.status})`);
  }
}

const slugs = ['swiggy', 'zomato', 'razorpay', 'cred', 'zerodha', 'meesho', 'groww', 'phonepe', 'unacademy'];
Promise.all(slugs.map(testSlug));
