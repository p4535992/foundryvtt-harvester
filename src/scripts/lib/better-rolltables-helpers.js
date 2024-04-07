import {
    customLootCompendium,
    harvestAction,
    harvesterBetterRollCompendium,
    harvesterCompendium,
    lootAction,
    lootCompendium,
} from "../../module";
import { CONSTANTS } from "../constants";
import Logger from "./Logger";
import { checkCompendium, formatDragon, retrieveItemSourceLabelDC, searchCompendium, testWithRegex } from "./lib";

export default class BetterRollTablesHelpers {
    static _testRegexTable(sourceValue, doc, actionName) {
        if (game.modules.get("better-rolltables")?.active) {
            let brtSourceReference = getProperty(doc, `flags.better-rolltables.brt-source-value`)?.trim() || "";
            if (brtSourceReference && actionName === harvestAction.name) {
                return testWithRegex(sourceValue, brtSourceReference);
            } else if (brtSourceReference && actionName === lootAction.name) {
                return testWithRegex(sourceValue, brtSourceReference);
            } else {
                return false;
            }
        } else {
            let standardSourceReference = getProperty(doc, `name`)?.trim() || "";
            standardSourceReference = standardSourceReference.replaceAll("Loot | ", "");
            standardSourceReference = standardSourceReference.replaceAll("Harvester | ", "");
            if (standardSourceReference && actionName === harvestAction.name) {
                return testWithRegex(sourceValue, standardSourceReference);
            } else if (standardSourceReference && actionName === lootAction.name) {
                return testWithRegex(sourceValue, standardSourceReference);
            } else {
                return false;
            }
        }
    }

    static retrieveTablesHarvestWithBetterRollTables(actorName, actionName) {
        if (actionName === harvestAction.name) {
            let sourceValue = actorName.trim() ?? "";
            if (sourceValue.includes("Dragon")) {
                sourceValue = formatDragon(sourceValue)?.trim();
            }
            let tablesChecked = [];
            // Try with the base compendium
            for (const doc of harvesterCompendium) {
                if (BetterRollTablesHelpers._testRegexTable(sourceValue, doc, actionName)) {
                    tablesChecked.push(doc);
                }
            }
            // TODO add some custom compendium ?
            if (game.modules.get("better-rolltables")?.active && harvesterBetterRollCompendium) {
                // Try with the brt tables
                for (const doc of harvesterBetterRollCompendium) {
                    if (BetterRollTablesHelpers._testRegexTable(sourceValue, doc, actionName)) {
                        Logger.debug(
                            `retrieveTablesHarvestWithBetterRollTables | Find document with check regex ${sourceValue}=${getProperty(doc, `flags.better-rolltables.brt-source-value`)?.trim()}`,
                        );
                        tablesChecked.push(doc);
                    }
                }
            }
            // Try on the tables imported
            if (!tablesChecked || tablesChecked.length === 0) {
                tablesChecked = game.tables.contents.filter((doc) => {
                    return BetterRollTablesHelpers._testRegexTable(sourceValue, doc, actionName);
                });
            }
            // We juts get the first
            if (!tablesChecked || tablesChecked.length === 0) {
                Logger.warn(
                    `retrieveTablesHarvestWithBetterRollTables | BRT No rolltable found for metadata sourceId '${sourceValue}'`,
                    true,
                );
                return [];
            }
            return tablesChecked;
        } else {
            Logger.warn(
                `retrieveTablesHarvestWithBetterRollTables | BRT No rolltable found for action '${harvestAction.name}'`,
                true,
            );
            return [];
        }
    }

    static async retrieveItemsDataHarvestWithBetterRollTables(
        actorName,
        actionName,
        dcValue = null,
        skillDenom = null,
    ) {
        let returnArr = [];
        if (actionName === harvestAction.name) {
            if (!dcValue) {
                dcValue = 0;
            }
            if (!skillDenom) {
                skillDenom = "";
            }

            const tablesChecked = BetterRollTablesHelpers.retrieveTablesHarvestWithBetterRollTables(
                actorName,
                actionName,
            );
            if (!tablesChecked || tablesChecked.length === 0) {
                Logger.warn(
                    `retrieveItemsDataHarvestWithBetterRollTables | BRT No rolltable found for action '${actionName}'`,
                    true,
                );
                return [];
            }
            const tableHarvester = tablesChecked[0];
            if (game.modules.get("better-rolltables")?.active) {
                returnArr = await game.modules.get("better-rolltables").api.retrieveItemsDataFromRollTableResult({
                    table: tableHarvester,
                    options: {
                        rollMode: "gmroll",
                        dc: dcValue,
                        skill: skillDenom,
                        displayChat: false,
                    },
                });
            } else {
                // let results = (await tableHarvester.drawMany(roll.total, { displayChat, recursive: true })).results;
                let results = tableHarvester.results.contents || [];
                const rolledItems = [];
                for (const rollData of results) {
                    let item;
                    if (rollData.documentCollection === "Item") {
                        item = game.items.get(rollData.documentId);
                    } else {
                        const compendium = game.packs.get(rollData.documentCollection);
                        if (compendium) {
                            item = await compendium.getDocument(rollData.documentId);
                        }
                    }

                    if (!item) {
                        Logger.warn(`No item is been found with this reference`, false, rollData);
                        continue;
                    }

                    if (item instanceof RollTable) {
                        // do nothing
                    } else if (item instanceof Item) {
                        rolledItems.push(item);
                    }
                }
                for (const item of rolledItems) {
                    if (item) {
                        Logger.debug(`HarvestingHelpers | STANDARD check matchedItem`, item);
                        let itemDC = 0;
                        if (item.compendium.metadata.id === CONSTANTS.harvestCompendiumId) {
                            itemDC = parseInt(item.system.description.chat);
                        } else {
                            itemDC = retrieveItemSourceLabelDC(item);
                        }
                        Logger.debug(`HarvestingHelpers | Item DC is '${itemDC}'`);
                        if (itemDC <= dcValue) {
                            Logger.debug(`HarvestingHelpers | STANDARD the item ${item.name} is been added as success`);
                            const itemData = item instanceof Item ? item.toObject() : item;
                            foundry.utils.setProperty(itemData, `uuid`, item.uuid || null);
                            returnArr.push(item);
                        }
                        Logger.debug(`HarvestingHelpers | STANDARD returnArr`, returnArr);
                    }
                }
            }
        } else {
            Logger.warn(
                `retrieveItemsDataHarvestWithBetterRollTables | BRT No rolltable found for action '${harvestAction.name}'`,
                true,
            );
            return [];
        }

        return returnArr ?? [];
    }

    static async retrieveResultsDataLootWithBetterRollTables(tableEntity, actorName, actionName) {
        let returnArr = [];
        if (actionName === lootAction.name) {
            const tableLooting = tableEntity;
            if (game.modules.get("better-rolltables")?.active) {
                returnArr = await game.modules.get("better-rolltables").api.betterTableRoll(tableLooting, {
                    rollMode: "gmroll",
                    displayChat: false,
                });
            } else {
                returnArr = await tableLooting.drawMany({
                    rollMode: "gmroll",
                    displayChat: false,
                });
            }
        } else {
            Logger.warn(
                `retrieveResultsDataLootWithBetterRollTables | BRT No rolltable found for action '${lootAction.name}'`,
                true,
            );
            return [];
        }

        return returnArr ?? [];
    }

    static retrieveTablesLootWithBetterRollTables(actorName, actionName) {
        if (actionName === lootAction.name) {
            let sourceValue = actorName.trim() ?? "";
            if (sourceValue.includes("Dragon")) {
                sourceValue = formatDragon(sourceValue)?.trim();
            }
            let tablesChecked = [];
            // Try with the base compendium
            for (const doc of lootCompendium) {
                if (BetterRollTablesHelpers._testRegexTable(sourceValue, doc, actionName)) {
                    tablesChecked.push(doc);
                }
            }
            // Try with the custom compendium
            for (const doc of customLootCompendium) {
                if (BetterRollTablesHelpers._testRegexTable(sourceValue, doc, actionName)) {
                    tablesChecked.push(doc);
                }
            }
            // TODO add some brt compendium ?
            // Try on the tables imported
            if (!tablesChecked || tablesChecked.length === 0) {
                tablesChecked = game.tables.contents.filter((doc) => {
                    return BetterRollTablesHelpers._testRegexTable(sourceValue, doc, actionName);
                });
            }
            // We juts get the first
            if (!tablesChecked || tablesChecked.length === 0) {
                Logger.warn(
                    `retrieveTablesLootWithBetterRollTables | BRT No rolltable found for metadata sourceId '${sourceValue}'`,
                    true,
                );
                return [];
            }
            return tablesChecked;
        } else {
            Logger.warn(
                `retrieveTablesLootWithBetterRollTables | BRT No rolltable found for action '${lootAction.name}'`,
                true,
            );
            return [];
        }
    }
}
