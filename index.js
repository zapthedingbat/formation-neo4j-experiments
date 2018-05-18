const neo4j = require('neo4j-driver');
const delay = require('./lib/delay');
const requestJson = require('./lib/request-json');
const escapeJsonString = require('./lib/escape-json-string');

// We're gonna need a password
const neo4jPassword = process.env.NEO4J_PASSWORD;
if(!neo4jPassword){
    throw new Error('NEO4J_PASSWORD environment variable is not set');
}

// We're gonna need an api
const formationApiEndpoint = process.env.FORMATION_API_ENDPOINT;
if(!formationApiEndpoint){
    throw new Error('FORMATION_API_ENDPOINT environment variable is not set');
}

const auth = neo4j.v1.auth.basic(process.env.NEO4J_USER || 'neo4j', neo4jPassword);
const driver = neo4j.v1.driver(process.env.NEO4J_URL || 'bolt://localhost', auth);

// Time in milliseconds before retrying after errors
const RETRY_TIMEOUT = 5000;

// Configurations for the import
const FORMATION_API_SEARCH_URL = `${formationApiEndpoint}/search?size=200`;
const BRAND = 'vogue';
const MARKET = 'de';

// Start with the first page of the search results
processPage(FORMATION_API_SEARCH_URL, BRAND, MARKET)
.then(() => {
    driver.close();
    console.log('Done');
})
.catch(error => {
    console.log('Application error', {error});
})

let totalHits;
let progress = 0;

// Processes a page of results from the formation Content API
function processPage(url, brand, market){

    // Request the search page from the content API
    return requestJson('GET', url)
    .then(res => {

        if(!totalHits){
            totalHits = res.hits.total;
        }

        // Map the entities in the search results into a flatter array
        const entities = res.hits.hits.map(hit => hit._source);

        // Add all the entities we found to the graph
        return addEntitiesToGraph(entities, brand, market)
        .then(() => {
            // Process the next page of results if there is one
            if(res._links.next){
                return processPage(res._links.next.uri, brand, market);
            }
        })
    })
    .catch((error) => {
        // Retry on failure
        console.log('Error loading page, retrying.', {error});
        return delay(RETRY_TIMEOUT).then(() => processPage(url, brand, market));
    }) 
}

function addEntitiesToGraph(entities, brand, market) {

    // It turns out Promise.all goes badly because neo deadlocks a lot because we are
    // trying to update the same node within the same session
    //
    // return Promise.all(entities.map(entity => processEntity(entity, brand, market)));

    // Alternative implementation for sequential processing.

    // Add each entity to the graph in sequence
    return (function next(i) {

        // Get the current entity from the array
        const entity = entities[i];
        if (entity){
            // Add add the entity to the graph
            return processEntity(entity, brand, market)
            .then(() => next(i+1)) // Call this function with the next entity
            .catch((error) => {
                // Retry on failure
                console.log('Error adding entity to graph, retrying.', {error});
                return delay(RETRY_TIMEOUT).then(() => next(i));
            }) 
        }
    }(0));
}

// Derive a title of a node from the entity using it's hed. Fall back to model and id.
function getTitle(entity){
    return entity.hed || `${entity.meta.modelName} ${entity.id}`;
}

// Derive a formatted label of a node from the entity model name.
function getModelName(entity){
    // Capitalise the first letter
    return entity.meta.modelName.replace(/^./, x =>  x.toUpperCase());
}

// Relationship names in neo need to be in uppercase with underscore delimiters
function getRelationshipName(rel){
    return rel
    .replace(/[A-Z]/g, x => `_${x}`) // Proceed all capitals with _
    .replace('-', () => '_') // Replace - with _
    .toUpperCase(); // Uppercase
}

// Add an entity to the graph
function processEntity(entity, brand, market) {

    progress++;
    console.log(`Progress ${progress}/${totalHits} (%${Math.round((progress/totalHits)*100)})`);

    const modelName = getModelName(entity);
    const id = entity.id;

    // Start a session
    const session = driver.session();

    // Start merging nodes and rels into the graph
    const p = addSingleEntityToGraph(session, id, modelName, entity, brand, market)
    .then(() => addTags(session, id, modelName, entity, brand, market))
    .then(() => addRels(session, id, modelName, entity, brand, market))
    .then(() => delay(10));

    // Close the session when we're done
    p.finally(() => {
        session.close();
    });

    return p;
}

function addTags(session, id, modelName, entity, brand, market) {

    // Ensure we have some tags
    if(!entity.tags || entity.tags.length === 0){
        return;
    }

    // Get the node we're working with
    let query = `MATCH (a:${modelName} {id:{id}})`;

    // Build a query to add tags
    if (entity.tags && entity.tags.length > 0) {

        // Escape the title of the tag
        const escapedTag = entity.tags.map(tag => escapeJsonString(tag));
        
        // Add the tags
        query += escapedTag.reduce((p, tag, i) => p += `MERGE (tag${i}:Tag {title:"${tag}", _market:{market}, _brand:{brand}})\n`, '');
        
        // Create the relationship from the node to the tags
        query += escapedTag.reduce((p, tag, i) => p += `CREATE (a)-[:TAGGED_WITH]->(tag${i})\n`, '');
    }

    // Run the query to update the graph
    return session.run(query, {
        id: entity.id,
        market,
        brand
    });
}

function addRels(session, id, modelName, entity, brand, market) {

    // Get the rels of the entity
    return requestJson('GET', entity._links.rels.uri)
    .then(res => {

        // Build a query to create all the relationships
        let query = `MATCH (a:${modelName} {id:{id}})\n`;
        const rels = Object.getOwnPropertyNames(res);

        // Bail out if there are not rels
        if(rels.length === 0){
            return;
        }

        // TODO: Use parameterization here rather than building ugly query strings
        rels.forEach((relName, i) => {
            const relationshipName = getRelationshipName(relName);
            const relationships = res[relName];

            relationships.forEach((relatedEntity, j) => {
                const relatedEntityModelName = getModelName(relatedEntity);
                const title = escapeJsonString(getTitle(relatedEntity));
                if(j > 0 || i > 0){
                    query += 'WITH a\n';
                }
                query += `MERGE (b:${relatedEntityModelName} {id:"${relatedEntity.id}", title:"${title}", _market:{market}, _brand:{brand}})\n`;
                query += `MERGE (a)-[:${relationshipName}]->(b)\n`;
            });
        });

        // Run the query to update the graph
        return session.run(query, {
            id: entity.id,
            market,
            brand
        });

    })
    .catch((error) => {
        // Retry on failure
        console.log('Error adding rels to graph, retrying.', {error});
        return delay(RETRY_TIMEOUT).then(() => addRels(session, id, modelName, entity, brand, market));
    })
}

function addSingleEntityToGraph(session, id, modelName, entity, brand, market) {

    // Create a nice Neo4j formatted name for the node label
    const title = getTitle(entity);

    // Apply all string type labels from the entity
    const labels = Object.getOwnPropertyNames(entity)
    .filter(propertyName => typeof entity[propertyName] === 'string')
    .filter(propertyName => !propertyName.startsWith('_'))
    .filter(propertyName => propertyName != 'body') // Don't include the body
    .reduce((l, propertyName) => {
        const value = entity[propertyName];
        if(value != ''){
            l[propertyName] = value;
        }
        return l;
    }, {});

    // Ensure the id is set (it should be, right?)
    labels.id = id;
    labels.title = title;

    // Add some metadata labels
    labels._uri = entity._links.self.uri;
    labels._brand = brand;
    labels._market = market;

    // Create our node with all our lovely properties
    let query = `MERGE (a:${modelName} {id:{id}}) SET a = $props`;

    // Run the query to add the node
    return session.run(query, {
        id: entity.id,
        props: labels
    });
}
