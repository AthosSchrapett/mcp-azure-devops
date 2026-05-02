const fetch = require('node-fetch');

const ORG = 'athosschrapett';
const PAT = process.env.AZURE_PAT;

const AUTH = Buffer.from(`:${PAT}`).toString('base64');

async function checkNamespaces() {
    const url = `https://dev.azure.com/${ORG}/_apis/securitynamespaces?api-version=7.0`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${AUTH}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        console.error('Failed to fetch namespaces:', await response.text());
        return;
    }

    const data = await response.json();
    const gitNamespace = data.value.find(ns => ns.name === 'Git Repositories');
    
    if (gitNamespace) {
        console.log('--- Git Repositories Namespace ---');
        console.log('ID:', gitNamespace.namespaceId);
        console.log('Actions:');
        gitNamespace.actions.forEach(action => {
            console.log(`  ${action.bit}: ${action.displayName} (${action.name})`);
        });
    } else {
        console.log('Git Repositories namespace not found.');
    }
}

async function listRepos() {
    const url = `https://dev.azure.com/${ORG}/Arenar/_apis/git/repositories?api-version=7.0`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${AUTH}`
        }
    });
    const data = await response.json();
    console.log('--- Repositories ---');
    data.value.forEach(repo => {
        console.log(`Name: ${repo.name}, ID: ${repo.id}`);
    });
}

async function searchIdentity() {
    const url = `https://vssps.dev.azure.com/${ORG}/_apis/identities?searchFilter=General&filterValue=athosschrapett&api-version=7.0`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${AUTH}`
        }
    });
    const data = await response.json();
    console.log('--- Identity Search ---');
    data.value.forEach(id => {
        console.log(`DisplayName: ${id.displayName}, Descriptor: ${id.descriptor}`);
    });
}

(async () => {
    try {
        await checkNamespaces();
        await listRepos();
        await searchIdentity();
    } catch (e) {
        console.error(e);
    }
})();
