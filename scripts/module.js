import { registerSettings, getSettings, dragonIgnoreArr, sizeHashMap } from "./settings.js";

var actionCompendium, harvestCompendium, harvestEffect, moduleSettings, socket;

Hooks.on("init", function()
{
  registerSettings();
  moduleSettings = getSettings();
  console.log("harvester | Init() - Registered settings.");
});

Hooks.on("ready", async function()
{
  actionCompendium = await game.packs.get("harvester.harvest-action").getDocuments();
  harvestCompendium = await game.packs.get("harvester.harvest").getDocuments();
  harvestEffect = actionCompendium[0].effects.get("0plmpCQ8D2Ezc1Do");
  console.log("harvester | ready() - Assigned public functions & Fetched compendiums");
  if (game.user?.isGM && !game.modules.get("socketlib")?.active)
    ui.notifications.error("socketlib must be installed & enabled for harvester to function correctly.", { permanent: true });
  if (moduleSettings.autoAddActionGroup != "None")
    addActionToActors();
});

Hooks.once("socketlib.ready", () => {
	socket = globalThis.socketlib.registerModule("harvester");
	socket.register("addHarvestEffect", addHarvestEffect);
	socket.register("addItemToActor", addItemToActor);
  console.log("harvester | Registed socketlib functions");
});

Hooks.on("createActor", (actor, data, options, id) =>
{
  if (moduleSettings.autoAddActionGroup != "None")
  {
    if(moduleSettings.autoAddActionGroup == "PCOnly" && actor.type == "npc")
      return;

    socket.executeAsGM(addItemToActor, actor.id, actionCompendium[0].id, actionCompendium[0].pack);
  }
})

function addActionToActors()
{
  var hasAction = false;
  game.actors.forEach(actor =>
  {
    if(moduleSettings.autoAddActionGroup == "PCOnly" && actor.type == "npc")
      return;
    actor.items.forEach(item =>{
      if(item.name === "Harvest" && item.system.source == "Harvester")
        hasAction = true;
    })
    if (!hasAction)
      socket.executeAsGM(addItemToActor, actor.id, actionCompendium[0].id, actionCompendium[0].pack);
  })
  console.log("harvester | ready() - Added Harvest Action to All Actors specified in Settings");
}

Hooks.on('dnd5e.preUseItem', function(item, config, options)
{
  if (item.name != "Harvest" && item.system.source != "Harvester")
    return;
  var controlToken = item.parent.getActiveTokens()[0];
  if(!validateHarvest(controlToken, game.user.targets))
    return false;

  item._source.system.description.value = `${item.name}ing ${game.user.targets.first().name}`
  //item._source.system.formula = "1d20 + @skills."+  +".mod"

  // Add skill check instead of rolling later on, will likely need a map to replace the skills with ability check?
})

Hooks.on('dnd5e.useItem', function(item, config, options)
{
  if (item.name != "Harvest" && item.system.source != "Harvester")
    return;

  var controlToken = item.parent.getActiveTokens()[0];
  var targetToken = game.user.targets.first();
  handleHarvest(targetToken, controlToken);
})

function validateHarvest(controlToken, userTargets)
{
  if (userTargets.size != 1)
  {
    ui.notifications.warn("Please target only one token.");
    return false;
  }
  var targetedToken = userTargets.first();
  var measuredDistance = canvas.grid.measureDistance(controlToken.center, targetedToken.center);
  var targetSize = sizeHashMap.get(targetedToken.actor.system.traits.size)
  if(measuredDistance > targetSize && moduleSettings.enforceRange)
  {
    ui.notifications.warn("You must be in range to Harvest.");
    return false;
  }
  if(targetedToken.document.actorData.system.attributes.hp.value != 0)
  {
    ui.notifications.warn(targetedToken.name + " is not dead");
    return false;
  }
  if(!checkEffect(targetedToken, "Dead") && moduleSettings.requireDeadEffect)
  {
    ui.notifications.warn(targetedToken.name + " is not dead");
    return false;
  }
  if(targetedToken.document.hasPlayerOwner && moduleSettings.npcOnlyHarvest)
  {
    ui.notifications.warn(targetedToken.name + " is not an NPC");
    return false;
  }
  if(checkEffect(targetedToken, "Harvested"))
  {
    ui.notifications.warn(targetedToken.name + " has been harvested already");
    return false;
  }
  return true;
}

function checkEffect(token, effectName)
{
  var returnBool = false;
  token.document.actorData.effects.forEach(element =>
  {
    if (element.label == effectName)
      returnBool = true;
  });
  return returnBool;
}

function searchCompendium(actor)
{
  var harvestArr = [];
  var actorName = actor.name;
  if (actorName.includes("Dragon"))
    actorName = formatDragon(actorName);

  harvestCompendium.forEach(doc =>
  {
    if (doc.system.source === actorName)
      harvestArr.push(doc);
  })
  return harvestArr;
}

function formatDragon(actorName)
{
  var actorSplit = actorName.split(" ");
  dragonIgnoreArr.forEach(element => {
    actorSplit = actorSplit.filter(e => e !== element);
  })

  actorSplit = actorSplit.join(" ")
  return actorSplit;
}

function addHarvestEffect(targetTokenId)
{
  var targetToken = canvas.tokens.get(targetTokenId)
  targetToken.toggleEffect(harvestEffect);
  console.log(`harvester | Added harvest effect to: ${targetToken.name}`);
}

function addItemToActor(actorId, itemId, packId)
{
  var actor = game.actors.get(actorId);
  var item = game.packs.get(packId).get(itemId);
  actor.createEmbeddedDocuments('Item', [item]);
  console.log(`harvester | Added item: ${item.name} to ${actor.name}`);
}

async function handleHarvest(targetedToken, controlledToken)
{
  var targetActor = await game.actors.get(targetedToken.document.actorId);
  var controlActor = await game.actors.get(controlledToken.document.actorId);

  var itemArr = await searchCompendium(targetActor);
  if (itemArr.length == 0)
  {
    ChatMessage.create({content: "<h3>Harvesting</h3>After examining the corpse you realise there is nothing you can harvest."});
    await socket.executeAsGM(addHarvestEffect, targetedToken.id);
    return;
  }

  var skillCheck = itemArr[0]?.system.description.unidentified.slice(0,3).toLowerCase();
  var result = await controlActor.rollSkill(skillCheck);
  if (result)
  {
    var lootMessage = "";
    var messageData = {content: {}, whisper: {}};
    if (moduleSettings.gmOnly)
      messageData.whisper = game.users.filter(u => u.isGM).map(u => u._id);

    await socket.executeAsGM(addHarvestEffect, targetedToken.id);

    itemArr.forEach(item =>
    {
      if (parseInt(item.system.description.chat) <= result.total)
      {
        lootMessage += `<li>@UUID[${item.uuid}]</li>`

        if(moduleSettings.autoAddItems)
          socket.executeAsGM(addItemToActor, controlActor.id, item.id, item.pack);
      }
    });

    if (lootMessage)
      messageData.content = `<h3>Harvesting</h3><ul>${lootMessage}</ul>`;
    else
      messageData.content = `<h3>Harvesting</h3><ul>${controlledToken.name} attempted to harvest resources from ${targetedToken.name} but failed to find anything.`
    ChatMessage.create(messageData);
  }
}