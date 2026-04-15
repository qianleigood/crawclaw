const puppeteer = require('puppeteer-core');

const USER_PROFILE_URL = 'https://www.xiaohongshu.com/user/profile/665175ad0000000003030945';

async function getFollowerCount() {
  const browser = await puppeteer.connect({
    browserWSEndpoint: 'ws://[::1]:9222/devtools/browser/42f77935-7638-4b92-9e6d-73b965c9a8ee',
    defaultViewport: null
  });
  console.log('Connected to Chrome on port 9222 via WebSocket');
  
  const pages = await browser.pages();
  let page;
  if (pages.length > 0) {
    page = pages[0];
    console.log('Using existing tab');
  } else {
    page = await browser.newPage();
    console.log('Created new tab');
  }
  
  console.log('Navigating to:', USER_PROFILE_URL);
  await page.goto(USER_PROFILE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  
  // Wait for the page to fully load with dynamic content
  await new Promise(r => setTimeout(r, 8000));
  
  // Extract follower count using multiple strategies
  const result = await page.evaluate(() => {
    // Strategy 1: Look for the specific follower count elements
    // Xiaohongshu profile page has elements like:
    // <span class="follower-count">1.2万</span> or "粉丝 1.2万"
    
    // Get all spans and divs that might contain follower info
    const allEls = document.querySelectorAll('*');
    const results = [];
    
    for (const el of allEls) {
      const text = el.innerText || '';
      if (text.includes('粉丝') && text.length < 50) {
        results.push({tag: el.tagName, class: el.className, id: el.id, text: text.trim()});
      }
    }
    
    // Strategy 2: Look for specific data in scripts or JSON
    const scripts = document.querySelectorAll('script');
    const scriptData = [];
    scripts.forEach(s => {
      const txt = s.innerText;
      if (txt.includes('fansCount') || txt.includes('粉丝')) {
        scriptData.push(txt.substring(0, 500));
      }
    });
    
    // Strategy 3: Look at the URL bar for any redirected URL with user data
    
    return {
      followerElements: results.slice(0, 30),
      scriptData: scriptData.slice(0, 3),
      url: window.location.href,
      title: document.title
    };
  });
  
  console.log('\n=== RESULT ===');
  console.log('URL:', result.url);
  console.log('Title:', result.title);
  console.log('\nFollower elements found:', result.followerElements.length);
  result.followerElements.forEach((el, i) => {
    console.log(`  ${i+1}. [${el.tag}] ${el.class} | "${el.text}"`);
  });
  
  if (result.scriptData.length > 0) {
    console.log('\nScript data snippet:', result.scriptData[0].substring(0, 300));
  }
  
  await browser.close();
  return result;
}

getFollowerCount()
  .then(r => { console.log('\nDone'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
