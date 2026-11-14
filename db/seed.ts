import { dbClient, dbConn } from "@db/client.js";
import { usersTable, accountsTable } from "@db/schema.js";
import bcrypt from "bcrypt";
import fs from "fs";

const saltRounds = 10;
const seedAccountsFile = "seed_accounts.json";
const seedAccountsData = JSON.parse(fs.readFileSync(seedAccountsFile, "utf-8"));

async function insertData() {
  seedAccountsData.forEach(
    async (account: {
      name: string;
      email: string;
      password: string;
      isAdmin: boolean;
    }) => {
      const hashedPassword = await bcrypt.hash(account.password, saltRounds);
      try {
        const res = await dbClient
          .insert(usersTable)
          .values([
            {
              name: account.name,
              email: account.email,
              isAdmin: account.isAdmin,
              password: hashedPassword,
              avatarURL: "logos/robot.png",
            },
          ])
          .returning({ id: usersTable.id });
        console.log(`Inserted user with ID: ${res[0].id}`);
      } catch (error) {
        console.log(error);
      }
    },
  );
}

insertData();
