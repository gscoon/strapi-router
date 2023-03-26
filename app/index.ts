import Path from 'path';
import { getCMSData, eachSeries, ICollectionItem } from './util';
import selfsigned from 'selfsigned';
import axios from 'axios';
import { domain } from 'process';

const rootParentDir = Path.join(__dirname, './../');

require('dotenv').config({
    path: Path.join(rootParentDir, '.env')
});

interface iCert {
    private: string,
    public: string,
    cert: string,
}

interface iDomain {
    id: number,
    domainName: string,
    forwardHost: string,
    forwardPort: number,
    useSSL: boolean,
}


const port = parseInt(process.env.ROUTER_PORT || '8080');
const portSecure = parseInt(process.env.ROUTER_PORT_SECURE || '4433');

(async () => {
    try {
        const { data } = await authGET('/api/domains');

        const domains = data.map(({ id, attributes }) => {
            const { domainName, forwardHost, forwardPort, useSSL } = attributes;
            return { id, domainName, forwardHost, forwardPort };
        });

        console.log('domains', domains);

        setupRouter(domains);
    } catch (err) {
        console.error('err', err);
    }

})();

async function setupRouter(domains: iDomain[]) {
    const sslPath = process.env.SSL_PATH ? process.env.SSL_PATH : Path.join(rootParentDir, './ssl');
    const timeout = process.env.PROXY_TIMEOUT ? parseInt(process.env.PROXY_TIMEOUT) : 600000;
    const proxy = require('redbird')({
        secure: false,
        port,
        letsencrypt: {
            path: sslPath,
            // port: 9999 // LetsEncrypt minimal web server port for handling challenges. Routed 80->9999, no need to open 9999 in firewall. Default 3000 if not defined.
        },
        ssl: {
            // http2: true,
            port: 443, // SSL port used to serve registered https routes with LetsEncrypt certificate.
        },
        timeout,
        proxyTimeout: timeout,
    });

    await eachSeries(domains, async ({ domainName, forwardHost, forwardPort, useSSL }) => {
        // const pems = await generateSelfSignedCert([{ name: 'commonName', value: domainName }]);

        const options: any = {};

        if (useSSL) {
            options.ssl = {
                letsencrypt: {
                    email: process.env.SSL_EMAIL || 'gscoon@gmail.com',
                    production: process.env.NODE_ENV === 'production',
                }
            };
        }

        const outgoing = `${forwardHost}:${forwardPort}`;
        console.log(`Domain: ${domainName}`)
        console.log(`Outgoing: ${outgoing}`)
        proxy.register(domainName, outgoing, options);
    });
}

async function authGET(endPoint: string): Promise<any> {
    const apiHost = getCMSAPIHost();
    const options = getAuthCMSOptions();

    try {
        const full = await axios.get(`${apiHost}${endPoint}`, { ...options, });
        const { data } = full;
        return data;
    } catch (err) {
        console.error('err', err);
        throw err;
    }
}

function getCMSAPIHost() {
    const cmsHost = process.env.CMS_API_HOST || 'http://127.0.0.1';
    const cmsPort = process.env.CMS_API_PORT || 1337;

    return `${cmsHost}:${cmsPort}`;
}

function generateSelfSignedCert(attrs): Promise<iCert> {
    return new Promise((resolve, reject) => {
        selfsigned.generate(attrs, { days: 365 }, function (err, pems) {
            if (err) {
                return reject(err);
            }

            resolve(pems);
        });
    });
}

function getAuthCMSOptions() {
    const apiToken = process.env.CMS_API_TOKEN || 'token-not-set';

    return {
        headers: {
            Authorization: `Bearer ${apiToken}`,
        }
    }
}