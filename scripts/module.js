import { registerSettings, SETTINGS, CONSTANTS, dragonIgnoreArr, sizeHashMap } from "./settings.js";

var actionCompendium, harvestCompendium, lootCompendium, harvestAction, lootAction, socket;

Hooks.on("init", function()
{
  registerSettings();
  console.log("harvester | Init() - Registered settings & Fetched compendiums.");
});

Hooks.on("ready", async function()
{
  actionCompendium = await game.packs.get(CONSTANTS.actionCompendiumId).getDocuments();
  harvestCompendium = await game.packs.get(CONSTANTS.harvestCompendiumId).getDocuments();
  lootCompendium = await game.packs.get(CONSTANTS.lootCompendiumId).getDocuments();

  harvestAction = actionCompendium.find(a => a.id == CONSTANTS.harvestActionId);
  lootAction = actionCompendium.find(a => a.id == CONSTANTS.lootActionId);

  if (game.user?.isGM && !game.modules.get("socketlib")?.active)
    ui.notifications.error("socketlib must be installed & enabled for harvester to function correctly.", { permanent: true });
  if (SETTINGS.autoAddActionGroup != "None")
    addActionToActors();
});

Hooks.once("socketlib.ready", () => {
	socket = globalThis.socketlib.registerModule("harvester");
	socket.register("addEffect", addEffect);
	socket.register("addItemToActor", addItemToActor);
  console.log("harvester | Registed socketlib functions");
});

Hooks.on("createActor", (actor, data, options, id) =>
{
  if (SETTINGS.autoAddActionGroup != "None")
  {
    if(SETTINGS.autoAddActionGroup == "PCOnly" && actor.type == "npc")
      return;

    socket.executeAsGM(addItemToActor, actor.id, CONSTANTS.harvestActionId, CONSTANTS.actionCompendiumId);
    socket.executeAsGM(addItemToActor, actor.id, CONSTANTS.lootActionId, CONSTANTS.actionCompendiumId);
  }
})

Hooks.on('dnd5e.preUseItem', function(item, config, options)
{
  if (item.system.source != "Harvester")
    return;

  if(!validateAction(item.parent.getActiveTokens()[0], game.user.targets, item.name))
    return false;

  item._source.system.description.value = `${item.name}ing ${game.user.targets.first().name}`
  // item._source.system.formula = "1d20 + @skills.ath.bonus"
  // item._source.system.actionType = "abil"

  // Add skill check instead of rolling later on, requires a custom roll formula as it needs skill rolls not ability scores, this displays "Other Formula" under the card which isnt ideal.
})

Hooks.on('dnd5e.useItem', function(item, config, options)
{
  if (item.system.source != "Harvester")
    return;

  handleAction(item.parent.getActiveTokens()[0], game.user.targets.first(), item.name);
})

function validateAction(controlToken, userTargets, actionName)
{
  if (userTargets.size != 1)
  {
    ui.notifications.warn("Please target only one token.");
    return false;
  }
  var targetedToken = userTargets.first();
  var measuredDistance = canvas.grid.measureDistance(controlToken.center, targetedToken.center);
  var targetSize = sizeHashMap.get(targetedToken.actor.system.traits.size)
  if(measuredDistance > targetSize && SETTINGS.enforceRange)
  {
    ui.notifications.warn("You must be in range to " + actionName);
    return false;
  }
  if(targetedToken.document.actorData.system.attributes.hp.value != 0)
  {
    ui.notifications.warn(targetedToken.name + " is not dead");
    return false;
  }
  if(!checkEffect(targetedToken, "Dead") && SETTINGS.requireDeadEffect)
  {
    ui.notifications.warn(targetedToken.name + " is not dead");
    return false;
  }
  if(targetedToken.document.hasPlayerOwner && SETTINGS.npcOnlyHarvest)
  {
    ui.notifications.warn(targetedToken.name + " is not an NPC");
    return false;
  }
  if(checkEffect(targetedToken, `${actionName}ed`))
  {
    ui.notifications.warn(`${targetedToken.name} has been ${actionName.toLowerCase()}ed already`);
    return false;
  }
  return true;
}

async function handleAction(controlledToken, targetedToken, actionName)
{
  var targetActor = await game.actors.get(targetedToken.document.actorId);
  var controlActor = await game.actors.get(controlledToken.document.actorId);

  var itemArr = [];
  var result;
  var lootMessage = "";
  var messageData = {content: {}, whisper: {}};
  if (SETTINGS.gmOnly)
    messageData.whisper = game.users.filter(u => u.isGM).map(u => u._id);

  itemArr = await searchCompendium(targetActor, actionName);
  if (itemArr.length == 0)
  {
    ChatMessage.create({content: `<h3>${actionName}ing</h3>After examining the corpse you realise there is nothing you can ${actionName.toLowerCase()}.`});
    await socket.executeAsGM(addEffect, targetedToken.id, actionName);
    return;
  }

  if (actionName == "Harvest")
  {
    var skillCheck = itemArr[0]?.system.description.unidentified.slice(0,3).toLowerCase();
    result = await controlActor.rollSkill(skillCheck, {chooseModifier: false});
    if (!result)
      return;
  }

  await socket.executeAsGM(addEffect, targetedToken.id, actionName);

  if (actionName == "Harvest")
  {
    itemArr.forEach(item =>
    {
        if (parseInt(item.system.description.chat) <= result.total)
        {
          lootMessage += `<li>@UUID[${item.uuid}]</li>`

          if(SETTINGS.autoAddItems)
            socket.executeAsGM(addItemToActor, controlActor.id, item.id, item.pack);
        }
    });

    if (lootMessage)
      messageData.content = `<h3>${actionName}ing</h3><ul>${lootMessage}</ul>`;
    else
      messageData.content = `<h3>${actionName}ing</h3><ul>${controlledToken.name} attempted to ${actionName.toLowerCase()} resources from ${targetedToken.name} but failed to find anything.`
    ChatMessage.create(messageData);
    return;
  }

  if (actionName == "Loot")
  {
    //const roll = await itemArr[0].draw({ rollMode: "gmroll" });

    // console.log(itemArr[0])
    // var canLoot = itemArr[0].description;
    itemArr[0].description = ""
    const roll = await itemArr[0].draw();
    // console.log(roll)

    // roll.compendium.metadata.id == CONSTANTS.lootCompendiumId
    // if(SETTINGS.autoAddItems)
    // Add currency to actor
  }
}

function searchCompendium(actor, actionName)
{
  var returnArr = [];
  var actorName = actor.name;
  if (actorName.includes("Dragon"))
    actorName = formatDragon(actorName);

  if(actionName == "Harvest")
  {
    harvestCompendium.forEach(doc =>
    {
      if (doc.system.source === actorName)
        returnArr.push(doc);
    })
  }
  else if (actionName == "Loot")
  {
    lootCompendium.forEach(doc =>
    {
      if (doc.name === actorName)
        returnArr.push(doc);
    })
  }

  return returnArr;
}

function addActionToActors()
{
  var hasHarvest = false;
  var hasLoot = false;
  game.actors.forEach(actor =>
  {
    if(SETTINGS.autoAddActionGroup == "PCOnly" && actor.type == "npc")
      return;
    actor.items.forEach(item =>{
      if(item.name === "Harvest" && item.system.source == "Harvester")
        hasHarvest = true;
      if(item.name === "Loot" && item.system.source == "Harvester")
        hasLoot = true;
    })
    if (!hasHarvest)
      socket.executeAsGM(addItemToActor, actor.id, CONSTANTS.harvestActionId, CONSTANTS.actionCompendiumId);
    if (!hasLoot)
      socket.executeAsGM(addItemToActor, actor.id, CONSTANTS.lootActionId, CONSTANTS.actionCompendiumId);
  })
  console.log("harvester | ready() - Added Harvest Action to All Actors specified in Settings");
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

function formatDragon(actorName)
{
  var actorSplit = actorName.split(" ");
  dragonIgnoreArr.forEach(element => {
    actorSplit = actorSplit.filter(e => e !== element);
  })

  actorSplit = actorSplit.join(" ")
  return actorSplit;
}

function addEffect(targetTokenId, actionName)
{
  var targetToken = canvas.tokens.get(targetTokenId)
  if(actionName == "Harvest")
    targetToken.toggleEffect(harvestAction.effects.get(CONSTANTS.harvestActionEffectId));
  else if (actionName == "Loot")
    targetToken.toggleEffect(lootAction.effects.get(CONSTANTS.lootActionEffectId));
  console.log(`harvester | Added ${actionName.toLowerCase()}ed effect to: ${targetToken.name}`);
}

function addItemToActor(actorId, itemId, packId)
{
  var actor = game.actors.get(actorId);
  var item = game.packs.get(packId).get(itemId);
  actor.createEmbeddedDocuments('Item', [item]);
  console.log(`harvester | Added item: ${item.name} to ${actor.name}`);
}