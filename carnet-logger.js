import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const argv = yargs(hideBin(process.argv)).argv;

async function login() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    console.log('LOGIN: opening login page');
    await page.goto('https://www.myvolkswagen.net/app/authproxy/login?fag=vw-phs,vwag-weconnect&scope-vw-phs=profile,cars,vin&scope-vwag-weconnect=openid,mbb&prompt-vw-phs=login&prompt-vwag-weconnect=none&redirectUrl=https://www.myvolkswagen.net/at/de/myvolkswagen.html');

    await page.waitForSelector('#input_email');

    await page.type('#input_email', argv.email);

    console.log('LOGIN: typed in email, click next');
    await page.click('#next-btn');

    await page.waitForSelector('#password');
    await page.type('#password', argv.password);

    console.log('LOGIN: typed in password, click next');
    await page.click('#next-btn');

    console.log('LOGIN: waiting for login response...');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });

    // get all cookies (also httponly cookies)
    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    const csrfToken = cookies.find(c => c.name === 'csrf_token').value;
    console.log('LOGIN CSRF token: ', csrfToken);

    // fetch idtoken and access token
    const response = await fetch('https://www.myvolkswagen.net/app/authproxy/vwag-weconnect/tokens', {
        headers: {
            cookie: cookies.map(c => `${c.name}=${c.value};`).join(' '),
            referer: 'https://www.myvolkswagen.net/at/de/myvolkswagen.html',
            accept: 'application/json, text/plain, */*',
            'x-csrf-token': csrfToken,
        }
    });

    const json = await response.json();
    const { access_token: accessToken } = json;
    console.log(`LOGIN access token: ${accessToken.substr(0, 10)}...`);

    await browser.close();

    return { accessToken };
}

async function getApiAccessToken(loginAccessToken) {
    console.log('API: exchange login access token for API access token');

    const response = await fetch('https://myvw-idk-token-exchanger.apps.emea.vwapps.io/token-exchange?isWcar=true', {
        headers: {
            origin: 'https://www.myvolkswagen.net',
            referer: 'https://www.myvolkswagen.net/',
            accept: 'application/json, text/plain, */*',
            authorization: `Bearer ${loginAccessToken}`,
        }
    });

    const apiAccessToken = await response.text();
    const apiAccessTokenBody = JSON.parse(atob(apiAccessToken.split('.')[1]));

    const { sub, aud } = apiAccessTokenBody;

    console.log(`API: access token: ${apiAccessToken.substr(0, 10)}...`);
    console.log(`API: sub=${sub} aud=${aud}`);
    console.log('API: give consent for API access');

    await fetch(`https://consent.vwgroup.io/consent/v2/users/${sub}/vehicles/${argv.fin}?client=${aud}&scopes=openid`, {
        headers: {
            origin: 'https://www.myvolkswagen.net',
            referer: 'https://www.myvolkswagen.net/',
            accept: 'application/json, text/plain, */*',
            authorization: `Bearer ${apiAccessToken}`,
        }
    });

    return { accessToken: apiAccessToken, sub, audience: aud };
}

async function getFuelStatus(apiAccessToken, sub) {
    console.log('API: get vehicle fuel status');

    const response = await fetch(`https://cardata.apps.emea.vwapps.io/vehicles/${argv.fin}/fuel/status`, {
        headers: {
            origin: 'https://www.myvolkswagen.net',
            referer: 'https://www.myvolkswagen.net/',
            accept: 'application/json, text/plain, */*',
            authorization: `Bearer ${apiAccessToken}`,
            'user-id': sub,
        }
    });

    const json = await response.json();
    console.log('API: response', JSON.stringify(json));
    return json;
}

/**
 * Do something with the received values.
 * @param {Object} status Fuel status.
 */
async function onDataReceived(status) {
    const { data } = status;
    const remainingRangeKm = data[0].properties.find(p => p.name === 'remainingRange_km').value;
    // SOC = state of charge
    const currentSOCPercent = data[0].properties.find(p => p.name === 'currentSOC_pct').value;

    console.log(`KNX: save remainingeRangeKm=${remainingRangeKm} to home.js`);

    await fetch('http://localhost:8080/writeEvent', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ga: '0/120', value: parseInt(remainingRangeKm) })
    });

    console.log(`KNX: save currentSOCPercent=${currentSOCPercent} to home.js`);

    await fetch('http://localhost:8080/writeEvent', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ga: '0/121', value: parseInt(currentSOCPercent) })
    });
}

async function main() {
    const { accessToken: loginAccessToken } = await login();
    const { accessToken: apiAccessToken, sub } = await getApiAccessToken(loginAccessToken);
    const status = await getFuelStatus(apiAccessToken, sub);
    await onDataReceived(status);
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.log(err);
        process.exit(1);
    });
