import Request from 'request';

export interface ICollectionItem {
    id: string | number,
    [x: string]: any,
}

export function getCMSHost() {
    let { CMS_HOST } = process.env;

    return CMS_HOST || 'http://127.0.0.1:8055';
}

export async function getCMSData<T = ICollectionItem>(path: string): Promise<T> {
    const url = `${getCMSHost()}${path}`;
    console.log('CMS req', url);

    return sendCMSRequest({
        url,
        method: 'GET',
    })
}

async function sendCMSRequest<T = ICollectionItem>(options): Promise<T> {
    return new Promise((resolve, reject) => {
        const auth = {
            headers: {
                Authorization: `Bearer ${process.env.CMS_TOKEN}`,
            }
        };

        Request({ ...options, ...auth }, (err, httpResponse, body) => {
            if (err) {
                return reject(err);
            }

            if (typeof body === 'string') {
                body = JSON.parse(body);
            }

            if (body.errors) {
                return reject(body.errors);
            }

            resolve(body.data);
        })
    })
}

export async function eachSeries<T>(arr: T[], func: (item: T, index: number) => any, breakOnError: boolean = false) {
    const retList = [];

    for (let i = 0; i < arr.length; i++) {
        const item = arr[i];

        try {
            retList.push(await func(item, i));
        } catch (err) {
            if (breakOnError) {
                throw err;
            }

            retList.push(err);
        }
    }

    return retList;
}