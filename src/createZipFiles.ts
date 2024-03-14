import {Database} from "duckdb-async";
import {createArrayCsvWriter} from "csv-writer";
import * as fs from "fs";

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
};

async function main() {
  const db = await Database.create(":memory:");
  await setup(db);
  const userData = await getUserData(db);

  userData.slice(66, 67).forEach(async (user) => {
    await makeCSV(db, user);
  });

  // userData.forEach(u => {
  //   if(u.email != null && u.googleEmail != null) {
  //     if(u.email != u.googleEmail) {
  //       console.log(u.email + " : " + u.googleEmail);
  //     }
  //   }
  // })

  // for(const creatorId of creatorIds) {
  //   await
  // }
  // const rows = await db.all(`
  //   SELECT * FROM challenge_item WHERE createdAt > '2023-10-01'
  //   LIMIT 10;
  // `)
  // console.log(rows);
}

async function makeCSV(db: Database, user: User): Promise<void> {
  // Create a directory for this user.
  const dir = "./user_data/" + user.id;
  fs.mkdir(dir, {recursive: true}, () => {});

  // Get the user's items, and write them to a CSV.
  const items: Item[] = await getItems(db, user.id);
  const item_writer = createArrayCsvWriter({
    path: dir + "/items.csv",
    header: [
      "user_id",
      "context",
      "item_id",
      "item_title",
      "item_doc",
      "explanation_doc",
    ],
  });
  item_writer.writeRecords(
    items.map((i) => [
      i.user_id,
      i.context,
      i.item_id,
      i.item_title,
      i.item_doc,
      i.explanation_doc ?? "",
    ]),
  );

  // Write user metadata to a file
  fs.writeFile(
    dir + "/user_summary.json",
    JSON.stringify({...user, email: "", googleEmail: ""}, null, 2),
    "utf8",
    () => {},
  );

  // Copy all images into a /images folder for the user.

  // Create a zip folder.
}

async function getItems(db: Database, userId: string): Promise<Item[]> {
  const challengeItemsRaw = await db.all(`
    SELECT
      c.title as context,
      ir.id,
      ir.title,
      ir.itemDoc,
      ir.explanationDoc
    FROM (SELECT * FROM user u WHERE id = '${userId}') u
    JOIN challenge c ON u.id = c.ownerId
    JOIN challenge_item ci ON c.id = ci.challengeId
    JOIN item_revision ir ON ci.itemRevisionId = ir.id
  `);
  const challengeItems: Item[] = challengeItemsRaw.map((i) => ({
    user_id: userId,
    context: i.context,
    item_id: i.id,
    item_title: i.title,
    item_doc: i.itemDoc,
    explanation_doc: i.explanationDoc ?? undefined,
  }));
  // const poolItemsRaw = await db.all(`
  //   SELECT
  //     c.title as context,
  //     ir.id,
  //     ir.title,
  //     ir.itemDoc,
  //     ir.explanationDoc
  //   FROM (SELECT * FROM user u WHERE id = '${userId}') u
  //   JOIN pool p ON u.id = p.ownerId
  //   JOIN item i ON p.id = i.poolId
  //   JOIN item_revision ir ON ci.itemRevisionId = ir.id
  // `);
  const poolItemsRaw = await db.all(`
    SELECT
      i.id,
      COUNT(*) as num_revisions
    FROM item i
    JOIN item_revision ir ON i.id = ir.draftItemId
    GROUP BY i.id
    ORDER BY num_revisions DESC
    LIMIT 10
  `);
  console.log(poolItemsRaw);
  const poolItems: Item[] = [];
  // const poolItems: Item[] =  poolItemsRaw.map(i => ({
  //   user_id: userId,
  //   context: i.context,
  //   item_id: i.id,
  //   item_title: i.title,
  //   item_doc: i.itemDoc,
  //   explanation_doc: i.explanationDoc ?? undefined,
  // }));
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
  // const recentItemsQueryResult = await db.all(`
  //   SELECT
  //     u.id,
  //     p.pool_items,
  //     c.challenge_items,
  //     COALESCE(p.pool_items, 0) + COALESCE(c.challenge_items, 0) AS num_items
  //   FROM user u
  //   LEFT JOIN (
  //     SELECT ownerId, COUNT(*) as pool_items
  //     FROM pool p
  //     JOIN (
  //       SELECT * FROM item WHERE createdAt > '2023-10-01'
  //     ) i ON i."poolId" = p.id
  //     GROUP BY ownerId
  //   ) p ON u.id = p.ownerId
  //   LEFT JOIN (
  //     SELECT
  //       ch.ownerId,
  //       COUNT(*) as challenge_items
  //     FROM challenge ch
  //     JOIN (
  //       SELECT * FROM challenge_item WHERE createdAt > '2023-10-01'
  //     ) ci ON ci."challengeId" = ch.id
  //     GROUP BY ownerId
  //   ) c ON u.id = c.ownerId
  //   WHERE
  //     num_items >= 1
  //   ORDER BY
  //       num_items ASC
  // `);
  // console.log(recentItemsQueryResult.slice(0, 10));
  // recentItemsQueryResult.forEach(row => {
  //   if(userData[row.id] != null) {
  //     userData[row.id].recentItemCount = Number(row.num_items ?? 0);
  //   }
  // });
  return Object.values(userData);
}

/**
 *
 */
async function setup(db: Database) {
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
  `);
}

main();
