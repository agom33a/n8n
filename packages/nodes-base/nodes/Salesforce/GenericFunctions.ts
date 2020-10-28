import {
	OptionsWithUri,
} from 'request';

import {
	IExecuteFunctions,
	IExecuteSingleFunctions,
	ILoadOptionsFunctions,
} from 'n8n-core';

import {
	IDataObject,
	INodePropertyOptions,
} from 'n8n-workflow';

import * as moment from 'moment-timezone';

import * as jwt from 'jsonwebtoken';

export async function salesforceApiRequest(this: IExecuteFunctions | IExecuteSingleFunctions | ILoadOptionsFunctions, method: string, endpoint: string, body: any = {}, qs: IDataObject = {}, uri?: string, option: IDataObject = {}): Promise<any> { // tslint:disable-line:no-any
	const authenticationMethod = this.getNodeParameter('authentication', 0, 'oAuth2') as string;

	try {
		if (authenticationMethod === 'jwt') {
			// https://help.salesforce.com/articleView?id=remoteaccess_oauth_jwt_flow.htm&type=5
			const credentialsType = 'salesforceJwtApi';
			const credentials = this.getCredentials(credentialsType);
			const response = await getAccessToken.call(this, credentials as IDataObject);
			const { instance_url, access_token } = response;
			const options = getOptions.call(this, method, (uri || endpoint), body, qs, instance_url as string);
			options.headers!.Authorization = `Bearer ${access_token}`;
			//@ts-ignore
			return await this.helpers.request(options);
		} else {
			// https://help.salesforce.com/articleView?id=remoteaccess_oauth_web_server_flow.htm&type=5
			const credentialsType = 'salesforceOAuth2Api';
			const credentials = this.getCredentials(credentialsType);
			const subdomain = ((credentials!.accessTokenUrl as string).match(/https:\/\/(.+).salesforce\.com/) || [])[1];
			const options = getOptions.call(this, method, (uri || endpoint), body, qs, `https://${subdomain}.salesforce.com`);
			//@ts-ignore
			return await this.helpers.requestOAuth2.call(this, credentialsType, options);
		}
	} catch (error) {
		if (error.response && error.response.body && error.response.body[0] && error.response.body[0].message) {
			// Try to return the error prettier
			throw new Error(`Salesforce error response [${error.statusCode}]: ${error.response.body[0].message}`);
		}
		throw error;
	}
}

export async function salesforceApiRequestAllItems(this: IExecuteFunctions | ILoadOptionsFunctions, propertyName: string, method: string, endpoint: string, body: any = {}, query: IDataObject = {}): Promise<any> { // tslint:disable-line:no-any
	const returnData: IDataObject[] = [];

	let responseData;
	let uri: string | undefined;

	do {
		responseData = await salesforceApiRequest.call(this, method, endpoint, body, query, uri);
		uri = `${endpoint}/${responseData.nextRecordsUrl?.split('/')?.pop()}`;
		returnData.push.apply(returnData, responseData[propertyName]);
	} while (
		responseData.nextRecordsUrl !== undefined &&
		responseData.nextRecordsUrl !== null
	);

	return returnData;
}

/**
 * Sorts the given options alphabetically
 *
 * @export
 * @param {INodePropertyOptions[]} options
 * @returns {INodePropertyOptions[]}
 */
export function sortOptions(options: INodePropertyOptions[]): void {
	options.sort((a, b) => {
		if (a.name < b.name) { return -1; }
		if (a.name > b.name) { return 1; }
		return 0;
	});
}

function getOptions(this: IExecuteFunctions | IExecuteSingleFunctions | ILoadOptionsFunctions, method: string, endpoint: string, body: any, qs: IDataObject, instanceUrl: string): OptionsWithUri { // tslint:disable-line:no-any
	const options: OptionsWithUri = {
		headers: {
			'Content-Type': 'application/json',
		},
		method,
		body: method === 'GET' ? undefined : body,
		qs,
		uri: `${instanceUrl}/services/data/v39.0${endpoint}`,
		json: true,
	};

	//@ts-ignore
	return options;
}

function getAccessToken(this: IExecuteFunctions | IExecuteSingleFunctions | ILoadOptionsFunctions, credentials: IDataObject): Promise<IDataObject> {
	const now = moment().unix();
	const authUrl = credentials.environment === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com';

	const signature = jwt.sign(
		{
			'iss': credentials.clientId as string,
			'sub': credentials.username as string,
			'aud': authUrl,
			'exp': now + 3 * 60,
		},
		credentials.privateKey as string,
		{
			algorithm: 'RS256',
			header: {
				'alg': 'RS256',
			},
		},
	);

	const options: OptionsWithUri = {
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		method: 'POST',
		form: {
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: signature,
		},
		uri: `${authUrl}/services/oauth2/token`,
		json: true,
	};

	//@ts-ignore
	return this.helpers.request(options);
}
