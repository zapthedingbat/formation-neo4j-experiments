# Experiments in visualisation and categorisation of content in the formation platform

The repos contains rudimentary scripts for pulling content from the formation content API and populating a neo4j graph. This was created with the intention of getting a better understanding of the existing tagging and categorisation of content in the formation platform. There are a number of avenues of investigation that this could potentially be useful for but at the time of writing I was interested in using tag co-occurrence to inform the design of a taxonomy and the plausibility of conflating concepts across languages.

As it stands right now the identifier of a category is scoped to an individual brand's content. Categories consist of only a name, a slug, and relationships to other categories. This means there is no way of attributing content across multiple brands to the same concept, irrespective of language.

It may be possible to build links between these categories or tags and their associated content across brands, markets and languages by leveraging existing multi lingual ontologies or knowledge graphs such as WikiData, DBpedia or BabelNet.

For example "Handbag" in wikidata WikiData is id Q467505 which is also "sac à main" in French or "Handtasche" in German.
https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Handbag&language=en&limit=20&format=json

## Building

```
npm i
```

## Running
- Create `/neo4j/data` and `/neo4j/logs` directories
- Start neo4j locally in docker
  `docker run -p 7474:7474 -7687:7687 -v./neo4j/data:/data -v./neo4j/logs:/logs neo4j`
- Navigate to http://localhost:7474/ in your browser to access neo4j and set the password
- Set the `NEO4J_PASSWORD` environment variable
- Start to importing content `npm start`