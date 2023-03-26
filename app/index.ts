import https from 'https';
import tls from 'tls';
import httpProxy from 'http-proxy';
import Greenlock from 'greenlock';
import express, { Application, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import Path from 'path';
import { getCMSData, eachSeries, ICollectionItem } from './util';
import selfsigned from 'selfsigned';
import axios from 'axios';
import { domain } from 'process';

const rootParentDir = Path.join(__dirname, './../');
const staticDir = Path.join(rootParentDir, './static');

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

const proxy = httpProxy.createProxyServer();

const greenlock = Greenlock.create({
    packageRoot: rootParentDir,
    maintainerEmail: 'gscoon@gmail.com',
    configDir: Path.join(rootParentDir, './greenlock.d'),
    staging: process.env.NODE_ENV !== 'production',
    notify: function (event, details) {
        if ('error' === event) {
            // `details` is an error object in this case
            console.error('Notify error', details);
        }
    },
    renewWithin: 81 * 24 * 60 * 60 * 1000,
    renewBy: 80 * 24 * 60 * 60 * 1000,
})

const portUnsecure = parseInt(process.env.ROUTER_PORT || '8080');
const portSecure = parseInt(process.env.ROUTER_PORT_SECURE || '4433');

(() => start())();

async function start() {
    const domains = await getDomains();
    console.log('domains', domains);

    const appUnsecure = express();
    appUnsecure.use(express.static(staticDir));
    appUnsecure.use((req: Request, res: Response, next: NextFunction) => {
        const domain = domains.find((d) => d.domainName === req.headers.host);
        if (!domain) {
            return res.status(404).send(`Domain not found ${req.headers.host}`);
        }

        const target = `http://${domain.forwardHost}:${domain.forwardPort}`;
        console.log(`Source: ${req.headers.host}`);
        console.log(`Target: ${target}`);

        proxy.web(req, res, { target }, (err) => {
            console.error('Proxy error', err);
            res.status(404).send(`Domain proxy error`);
        });
    });

    appUnsecure.listen(portUnsecure, async () => {
        console.log(`Listening on port ${portUnsecure}`);
        await doGreenlock(domains);

        await eachSeries(domains, async ({ domainName }) => {
        });
    });

    const sniCallback = async (serverName, callback) => {
        console.log('SNI serverName', serverName);

        const site = await greenlock.get({
            subject: serverName,
        })

        if (!site) {
            callback(new Error('No site found'));
        }

        callback(null, tls.createSecureContext({
            cert: site.pems.cert,
            key: site.pems.key,
        }));
    }

    const secureServer = https.createServer({
        SNICallback: sniCallback,
    });

    secureServer.listen(portSecure, () => {
        console.log(`Listening on port ${portSecure}`);
    });
}

async function getDomains(): Promise<iDomain[]> {
    const { data } = await authGET('/api/domains');

    const domains = data.map(({ id, attributes }) => {
        const { domainName, forwardHost, forwardPort, useSSL } = attributes;
        return { id, domainName, forwardHost, forwardPort, useSSL };
    });

    return domains;
}

async function doGreenlock(domains: iDomain[]) {
    await greenlock.manager.defaults({
        agreeToTerms: true,
        subscriberEmail: 'gscoon@gmail.com',
        challenges: {
            "http-01": {
                module: "acme-http-01-webroot",
                webroot: Path.join(staticDir, '.well-known/acme-challenge'),
            }
        }
    })

    await eachSeries(domains, async ({ domainName }) => {
        console.log('Adding domain', domainName);

        try {
            const data = await greenlock.add({
                subject: domainName,
                altnames: [domainName]
            });

            console.log('greenlock success', data);
        } catch (err) {
            console.error('Error adding domain', domainName, err);
        }
    });
}

async function setupStaticServer(): Promise<Application> {
    const staticApp = express();
    staticApp.use(express.static(staticDir));

    return new Promise((resolve) => {
        const server = staticApp.listen(portUnsecure, '0.0.0.0', () => {
            console.log(`Listening on port ${portUnsecure}`);
            resolve(server);
        });
    })
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

function getAuthCMSOptions() {
    const apiToken = process.env.CMS_API_TOKEN || 'token-not-set';

    return {
        headers: {
            Authorization: `Bearer ${apiToken}`,
        }
    }
}