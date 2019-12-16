const express = require("express");
const _ = require('lodash')
const cors = require('cors')
const p = require('util').promisify;
const promisifyAll = require('util-promisifyall')
const { parse } = require('json2csv');

const app = express()
  .use(express.json())
  .use(cors())

const Engine = require('tingodb')()
const db = new Engine.Db('.data', {});
const collection = promisifyAll(db.collection("tinymap_points"));

// Check whether that key can edit this layer. It's a bit clunky, but basically, we check for the existence of an item in that layer with some *other* key, in which case
// it's a no.
async function checkKey(layer, key, response) {
  if (!key) {
    return true;
  }
  const item = await collection.findOneAsync({ _layer: layer, $and: [{ _key: { $exists: true }} , { _key: { $ne: key }}]});

  // if there is a non-matching key, the check has failed
  if (item) {
    console.log(`Key ${key} invalid for ${layer}`);
    console.log(item)
    response.status(403).json({message:'This key is not valid for this layer.'})
  }
  return !item;
}


// get all items
app.get("/layer/:layer", async (req, res) => {
  const [,layer, format] = req.params.layer.match(/([^.]+)(.csv|geojson|)?/)
  console.log(layer, format);
  if (format === '.csv') {
    const itemsCursor = await collection.findAsync({ _layer: layer });
    itemsCursor.toArray((err, items) => {
      if (items) {
        const itemArray = items.map(feature => ({
          lng: feature.geometry.coordinates[0],
          lat: feature.geometry.coordinates[1],
        }));
        console.log('items: ', itemArray)
        const csv = parse(itemArray, {});
        console.log(csv)
        res.type('text/csv').send(csv);
      }
    });
  } else { // geojson
    const itemsCursor = await collection.findAsync({ _layer: layer });
    itemsCursor.toArray((err, items) => {
      res.json({
        type: 'FeatureCollection',
        features: items
          .filter(i => i.type === 'Feature')
          .map(i => {
            i.id = i._id;
            delete(i._key);
            return i
          })
      });
    });
  }
});

// get one item
app.get("/layer/:layer/:id", async (req, res) => {
  const item = await collection.findOneAsync({ _id: req.params.id });
  res.json({ ..._.omit(item,'_key'), id: item._id });
});

// create an item
app.post("/layer/:layer", async (req, res) => {
  console.log('Inserting', req.body)
  if (!await checkKey(req.params.layer, req.query.key, res)) {
    return;
  }
  const item = {
    ...req.body,
    _layer: req.params.layer
  }
  if (req.query.key) {
    item._key = req.query.key;
  }
  const insertedItem = (await collection.insertAsync(item))[0];
  console.log('Inserted', { ...insertedItem, id: insertedItem._id })
  res.json({ ...insertedItem, id: insertedItem._id });  
});

// delete an item
app.delete("/layer/:layer/:id", async (req, res) => {
  console.log('Deleting', req.params.id)
  if (!await checkKey(req.params.layer, req.query.key, res)) {
    return;
  }
  
  const result = await collection.removeAsync({ _id: req.params.id });
  res.json(result)  
});

// update an item
app.put("/layer/:layer/:id", async (req, res) => {
  console.log('Updating', req.params.id)
  if (!await checkKey(req.params.layer, req.query.key, res)) {
    return;
  }
  const feature = { ...req.body, _layer: req.params.layer }
  console.log(feature)
  const result = await collection.updateAsync({ _id: req.params.id }, feature);
  res.json(result)  
});

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", function(request, response) {
  response.sendFile(__dirname + "/views/index.html");
});

const listener = app.listen(process.env.PORT, function() {
  console.log("Your app is listening on port " + listener.address().port);
});
