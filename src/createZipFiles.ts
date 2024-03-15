import {Database} from "duckdb-async";
import * as archiver from "archiver";
import * as fsLegacy from "fs";
import * as fs from "fs/promises";

const UNZIPPED_BASE_DIR = process.cwd() + "/out/unzipped/";
const ZIPPED_BASE_DIR = process.cwd() + "/out/zipped/";

type User = {
  id: string;
  username: string;
  email?: string;
  googleEmail?: string;
  itemCounts: {
    all: number;
    poolItems: number;
    challengeItems: number;
    assessmentItems: number;
    liveItems: number;
    videoItems: number;
  };
  recentItemCount: number;
};

type Item = {
  user_id: string;
  context: string;
  item_id: string;
  item_title: string;
  item_doc: string;
  explanation_doc?: string;
  tags: string[];
};

async function main() {
  const db = await Database.create(":memory:");
  await dbSetup(db);
  await fs.mkdir(UNZIPPED_BASE_DIR, {recursive: true});
  await fs.mkdir(ZIPPED_BASE_DIR, {recursive: true});
  const userData = await getUserData(db);
  await Promise.all(
    userData.map(async (user) => {
      await makeCSV(db, user);
    }),
  );
}

async function makeCSV(db: Database, user: User): Promise<void> {
  // Create a directory for this user.
  const unzippedDir = UNZIPPED_BASE_DIR + user.username;
  await fs.rm(unzippedDir, {recursive: true, force: true});
  await fs.mkdir(unzippedDir, {recursive: true});

  // Get the user's items, and write them to a CSV.
  const items: Item[] = await getItems(db, user.id);
  const jsonFilename = unzippedDir + "/items.json";
  await fs.writeFile(jsonFilename, JSON.stringify(items), "utf8");

  // Write user metadata to a file
  const metadataFilename = unzippedDir + "/metadata.json";
  await fs.writeFile(
    metadataFilename,
    JSON.stringify({...user}, null, 2),
    "utf8",
  );
  const fileContent = await fs.readFile(jsonFilename, "utf-8");

  // Regular expression pattern to match URLs
  const urlPattern =
    /https:\/\/public\.itempooluserdata\.com\/[a-zA-Z0-9_-]+\-\d+\.[a-zA-Z]+/g;

  // Extract URLs from the file content
  const urls = fileContent.match(urlPattern) || [];
  if (urls.length >= 1) {
    const srcImgDir = process.cwd() + "/images/";
    const destImgDir = unzippedDir + "/images/";
    await fs.mkdir(destImgDir, {recursive: true});
    await Promise.all(
      urls.map(async (url) => {
        const imgFilename = url.substring(36);
        const sourcFilepath = srcImgDir + imgFilename;
        const destinationFilepath = destImgDir + imgFilename;
        await copyFile(sourcFilepath, destinationFilepath);
      }),
    );
  }

  // Create a zip folder.
  const zipPath = process.cwd() + "/out/zipped/" + user.username + ".zip";
  const output = fsLegacy.createWriteStream(zipPath);
  const archive = archiver.create("zip", {
    zlib: {level: 9}, // Compression level
  });
  output.on("close", function () {
    console.log(`SUCCESS ${user.username} — ${archive.pointer()} bytes`);
  });
  archive.on("error", function (err) {
    throw err;
  });
  archive.pipe(output);
  archive.directory(unzippedDir, false);
  await archive.finalize();
}

async function getItems(db: Database, userId: string): Promise<Item[]> {
  const challengeItemsRaw = await db.all(`
    SELECT
      c.title as context,
      ir.id,
      ir.title,
      ir.itemDoc,
      ir.explanationDoc,
      irt.tags
    FROM (SELECT * FROM user u WHERE id = '${userId}') u
    JOIN challenge c ON u.id = c.ownerId
    JOIN challenge_item ci ON c.id = ci.challengeId
    JOIN item_revision ir ON ci.itemRevisionId = ir.id
    LEFT JOIN (
      SELECT
        ir.id,
        list(it.normalizedName) as tags
      FROM item_revision ir
      JOIN item_tag_mapping itm ON ir.id = itm.itemRevisionId
      JOIN item_tag it ON itm.itemTagId = it.id
      GROUP BY ir.id
    ) irt ON irt.id = ir.id
  `);
  const challengeItems: Item[] = challengeItemsRaw.map((i) => ({
    user_id: userId,
    context: i.context,
    item_id: i.id,
    item_title: i.title,
    item_doc: i.itemDoc,
    explanation_doc: i.explanationDoc ?? undefined,
    tags: i.tags,
  }));
  const poolItemsRaw = await db.all(`
    SELECT
      p.title as context,
      ir.id,
      ir.title,
      ir.itemDoc,
      ir.explanationDoc,
      irt.tags
    FROM (SELECT * FROM user u WHERE id = '${userId}') u
    JOIN pool p ON u.id = p.ownerId
    JOIN item ON p.id = item.poolId
    JOIN item_revision ir ON ir.draftItemId = item.id
    LEFT JOIN (
      SELECT
        ir.id,
        list(it.normalizedName) as tags
      FROM item_revision ir
      JOIN item_tag_mapping itm ON ir.id = itm.itemRevisionId
      JOIN item_tag it ON itm.itemTagId = it.id
      GROUP BY ir.id
    ) irt ON irt.id = ir.id
  `);
  const poolItems: Item[] = poolItemsRaw.map((i) => ({
    user_id: userId,
    context: i.context,
    item_id: i.id,
    item_title: i.title,
    item_doc: i.itemDoc,
    explanation_doc: i.explanationDoc ?? undefined,
    tags: i.tags,
  }));
  return [...challengeItems, ...poolItems];
}

/**
 * Get all users who created a lot of content.
 */
async function getUserData(db: Database): Promise<User[]> {
  const userData: Record<string, User> = {};
  const countsQueryResult = await db.all(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.googleEmail,
      p.pool_items,
      c.challenge_items,
      c.assessment_items,
      c.video_items,
      c.live_items,
      COALESCE(p.pool_items, 0) + COALESCE(c.challenge_items, 0) AS num_items
    FROM user u
    LEFT JOIN (
      SELECT ownerId, COUNT(*) as pool_items
      FROM pool p
      JOIN item i ON i."poolId" = p.id
      GROUP BY ownerId
    ) p ON u.id = p.ownerId
    LEFT JOIN (
      SELECT
        ownerId,
        SUM(CASE WHEN renderType = 'ASSESSMENT' THEN challenge_items ELSE 0 END) as assessment_items,
        SUM(CASE WHEN renderType = 'VIDEO' THEN challenge_items ELSE 0 END) as video_items,
        SUM(CASE WHEN renderType = 'LIVE' THEN challenge_items ELSE 0 END) as live_items,
        SUM(challenge_items) AS challenge_items
      FROM (
        SELECT
          ch.ownerId,
          ch.renderType,
          COUNT(*) as challenge_items
        FROM challenge ch
        JOIN challenge_item ci ON ci."challengeId" = ch.id
        GROUP BY ownerId, renderType
      )
      GROUP BY ownerId
    ) c ON u.id = c.ownerId
    WHERE
      num_items > 10
    ORDER BY
      num_items DESC
  `);
  countsQueryResult.forEach((row) => {
    userData[row.id] = {
      id: row.id,
      username: row.username,
      email: row.email,
      googleEmail: row.googleEmail,
      itemCounts: {
        all: Number(row.num_items),
        poolItems: Number(row.pool_items),
        challengeItems: Number(row.challenge_items),
        assessmentItems: Number(row.assessment_items),
        liveItems: Number(row.live_items),
        videoItems: Number(row.video_items),
      },
      recentItemCount: 0,
    };
  });
  const recentItemsQueryResult = await db.all(`
    SELECT
      u.id,
      p.pool_items,
      c.challenge_items,
      COALESCE(p.pool_items, 0) + COALESCE(c.challenge_items, 0) AS num_items
    FROM user u
    LEFT JOIN (
      SELECT ownerId, COUNT(*) as pool_items
      FROM pool p
      JOIN (
        SELECT * FROM item WHERE createdAt > '2023-10-01'
      ) i ON i."poolId" = p.id
      GROUP BY ownerId
    ) p ON u.id = p.ownerId
    LEFT JOIN (
      SELECT
        ch.ownerId,
        COUNT(*) as challenge_items
      FROM challenge ch
      JOIN (
        SELECT * FROM challenge_item WHERE createdAt > '2023-10-01'
      ) ci ON ci."challengeId" = ch.id
      GROUP BY ownerId
    ) c ON u.id = c.ownerId
    WHERE
      num_items >= 1
    ORDER BY
        num_items ASC
  `);
  recentItemsQueryResult.forEach((row) => {
    if (userData[row.id] != null) {
      userData[row.id].recentItemCount = Number(row.num_items ?? 0);
    }
  });
  return Object.values(userData);
}

async function copyFile(sourceFile: string, destinationFile: string) {
  try {
    const data = await fs.readFile(sourceFile);
    await fs.writeFile(destinationFile, data);
  } catch (err) {
    console.error(`Error copying ${sourceFile} to ${destinationFile}`, err);
  }
}

async function dbSetup(db: Database) {
  // Creating tables improves the performance of future queries.
  // Also, then we have simple, easy-to-read table names to use in other queries.
  await db.exec(`
      CREATE OR REPLACE TABLE challenge AS SELECT * FROM read_parquet('database/parquet/itempool/public.challenge/1/*.parquet');
      CREATE OR REPLACE TABLE challenge_attempt AS SELECT * FROM read_parquet('database/parquet/itempool/public.challenge_attempt/1/*.parquet');
      CREATE OR REPLACE TABLE challenge_item_attempt AS SELECT * FROM read_parquet('database/parquet/itempool/public.challenge_item_attempt/1/*.parquet');
      CREATE OR REPLACE TABLE live_session AS SELECT * FROM read_parquet('database/parquet/itempool/public.live_session/1/*.parquet');
      CREATE OR REPLACE TABLE live_challenge AS SELECT * FROM read_parquet('database/parquet/itempool/public.live_challenge/1/*.parquet');
      CREATE OR REPLACE TABLE user AS SELECT * FROM read_parquet('database/parquet/itempool/public.user/1/*.parquet');
      CREATE OR REPLACE TABLE item_attempt AS SELECT * FROM read_parquet('database/parquet/itempool/public.item_attempt/1/*.parquet');
      CREATE OR REPLACE TABLE challenge_list AS SELECT * FROM read_parquet('database/parquet/itempool/public.challenge_list/1/*.parquet');
      CREATE OR REPLACE TABLE challenge_item AS SELECT * FROM read_parquet('database/parquet/itempool/public.challenge_item/1/*.parquet');
      CREATE OR REPLACE TABLE item AS SELECT * FROM read_parquet('database/parquet/itempool/public.item/1/*.parquet');
      CREATE OR REPLACE TABLE pool AS SELECT * FROM read_parquet('database/parquet/itempool/public.pool/1/*.parquet');
      CREATE OR REPLACE TABLE item_revision AS SELECT * FROM read_parquet('database/parquet/itempool/public.item_revision/1/*.parquet');
      CREATE OR REPLACE TABLE item_tag AS SELECT * FROM read_parquet('database/parquet/itempool/public.item_tag/1/*.parquet');
      CREATE OR REPLACE TABLE item_tag_mapping AS SELECT * FROM read_parquet('database/parquet/itempool/public.item_tag_mapping/1/*.parquet');
  `);
}

main();

// async function test() {
//   const db = await Database.create(":memory:");
//   dbSetup(db);
//   const res = await db.all(`
//     select
//       p.id,
//       list(t.normalizedName) as tags
//     from
//       pool p
//       join item_tag t ON p.id = t.poolId
//     group by p.id
//     limit
//       10;
//     `);
//   console.log(res);
// }
// test();
