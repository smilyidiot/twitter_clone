const express = require("express");
const path = require("path");
const app = express();
app.use(express.json());

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running At http://locahost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const convertJsonUser = (dbObj) => {
  return {
    userId: dbObj.user_id,
    name: dbObj.name,
    username: dbObj.username,
    password: dbObj.password,
    gender: dbObj.gender,
  };
};

const convertJsonFollower = (dbObj) => {
  return {
    followerId: dbObj.follower_id,
    followerUserId: dbObj.follower_user_id,
    followingUserId: dbObj.following_user_id,
  };
};
const convertJsonTweet = (dbObj) => {
  return {
    tweetId: dbObj.tweet_id,
    tweet: dbObj.tweet,
    userId: dbObj.user_id,
    dateTime: dbObj.date_time,
  };
};

const convertJsonReply = (dbObj) => {
  return {
    replyId: dbObj.reply_id,
    tweetId: dbObj.tweet_id,
    reply: dbObj.reply,
    userId: dbObj.user_id,
    dateTime: dbObj.date_time,
  };
};

const convertJsonLike = (dbObj) => {
  return {
    likeId: dbObj.like_id,
    userId: dbObj.user_id,
    tweetId: dbObj.tweet_id,
    dateTime: dbObj.date_time,
  };
};

const authenticateTokens = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "secretMessage", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//API 1 -> Register User
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;

  const hashedPassword = await bcrypt.hash(password, 10);

  const checkUserQuery = `
    SELECT *
    FROM user
    WHERE username = '${username}';`;
  const dbUser = await db.get(checkUserQuery);

  if (dbUser === undefined) {
    const createUserQuery = `
        INSERT INTO 
            user (username, password, name, gender)
        VALUES 
            ('${username}', '${password}', '${name}', '${gender}');`;
    if (password.length > 6) {
      await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2 -> Login User
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const checkUser = `
    SELECT *
    FROM user
    WHERE username = '${username}'; `;
  const dbUser = await db.get(checkUser);

  if (dbUser !== undefined) {
    const passCompare = await bcrypt.compare(password, dbUser.password);

    if (passCompare === true) {
      const payload = { username: username };

      const jwtToken = jwt.sign(payload, "secretMessage");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

const getUser = async (username) => {
  const userIdQuery = `
      SELECT user_id FROM user
          WHERE username = '${username}';`;
  const getUserId = await db.get(userIdQuery);
  return getUserId.user_id;
};

// API 3 -> Return Latest tweets, whom user follows, 4 tweets at a time
app.get("/user/tweets/feed/", authenticateTokens, async (request, response) => {
  let { username } = request;

  const userId = await getUser(username);
  const getTweetQuery = `
        SELECT
            username, tweet, date_time
        FROM
            (follower INNER JOIN tweet ON
            follower.following_user_id = tweet.user_id) AS T
            NATURAL JOIN user
        WHERE
            follower.follower_user_id = ${userId}
        ORDER BY
            date_time DESC
        LIMIT 4;`;

  const answer = await db.all(getTweetQuery);
  response.send(answer.map((item) => convertJsonTweet(item)));
});

//API 4 -> Returns list of all names whom user follows => following
app.get("/user/following/", authenticateTokens, async (request, response) => {
  const { username } = request;

  const userId = await getUser(username);

  const getFollowingName = `
    SELECT name
    FROM 
        user INNER JOIN follower ON
        user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${userId}`;
  const followingName = await db.all(getFollowingName);
  response.send(followingName);
});

//API 5 -> Returns list of all names whom the user follows => followers
app.get("/user/followers/", authenticateTokens, async (request, response) => {
  const { username } = request;

  const userId = await getUser(username);

  const getFollowerName = `
    SELECT name
    FROM 
        user INNER JOIN follower ON
        user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = ${userId}`;
  const followerName = await db.all(getFollowerName);
  response.send(followerName);
});

//API 6 -> Following Tweet details
app.get("/tweets/:tweetId/", authenticateTokens, async (request, response) => {
  const { username } = request;
  const userId = await getUser(username);
  const { tweetId } = request.params;

  const getTweetQuery = `
    SELECT *
    FROM
        tweet INNER JOIN follower
        ON tweet.user_id = follower.following_user_id
    WHERE
        tweet_id = ${tweetId} AND follower_user_id = ${userId};`;
  const tweet = await db.get(getTweetQuery);

  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getLikeCountQuery = `
        SELECT
            COUNT(*) AS likes
        FROM
            tweet INNER JOIN like
            ON tweet.tweet_id = like.tweet_id
        WHERE tweet.tweet_id = ${tweetId};`;
    const likes = await db.all(getLikeCountQuery);

    const getReplyQuery = `
        SELECT
            COUNT(*) AS replies
        FROM
            tweet INNER JOIN reply
            ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.tweet_id = ${tweetId};`;
    const replies = await db.all(getReplyQuery);

    response.send({
      tweet: tweet["tweet"],
      likes: likes[0]["likes"],
      replies: replies[0]["replies"],
      dateTime: tweet["date_time"],
    });
  }
});

//API 7 -> Tweet Likes
app.get(
  "/tweets/:tweetId/likes/",
  authenticateTokens,
  async (request, response) => {
    const { username } = request;
    const userId = await getUser(username);

    const { tweetId } = request.params;

    const getTweetQuery = `
    SELECT *
    FROM
        tweet INNER JOIN follower
        ON tweet.user_id = follower.following_user_id
    WHERE
        tweet_id = ${tweetId} AND follower_user_id = ${userId};`;

    const tweet = await db.get(getTweetQuery);

    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikesQuery = `
        SELECT
            username
        FROM
            (tweet INNER JOIN like
                ON tweet.tweet_id = like.tweet_id)
            INNER JOIN user ON
                user.user_id = like.user_id
        WHERE tweet.tweet_id = ${tweetId};`;
      const likes = await db.all(getLikesQuery);
      const likesData = likes.map((item) => item.username);
      response.send({
        likes: likesData,
      });
    }
  }
);
//API 8 -> Tweet Replies
app.get(
  "/tweets/:tweetId/replies/",
  authenticateTokens,
  async (request, response) => {
    const { username } = request;
    const userId = await getUser(username);

    const { tweetId } = request.params;

    const getTweetQuery = `
    SELECT *
    FROM
        tweet INNER JOIN follower
        ON tweet.user_id = follower.following_user_id
    WHERE
        tweet_id = ${tweetId} AND follower_user_id = ${userId};`;

    const tweet = await db.get(getTweetQuery);

    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getRepliesQuery = `
        SELECT
            user.name, reply.reply
        FROM
            (tweet INNER JOIN reply
                ON tweet.tweet_id = reply.tweet_id)
            INNER JOIN user ON
                user.user_id = reply.user_id
        WHERE tweet.tweet_id = ${tweetId};`;
      const replies = await db.all(getRepliesQuery);
      const repliesData = { replies: replies };
      response.send(repliesData);
    }
  }
);

const tweetStats = (dbObj) => {
  return {
    tweet: dbObj.tweet,
    likes: dbObj.likes,
    replies: dbObj.replies,
    dateTime: dbObj.date_time,
  };
};

//API 9 -> Returns list of all tweets of user
app.get("/user/tweets/", authenticateTokens, async (request, response) => {
  const { username } = request;
  const userId = await getUser(username);

  const getTweetQuery = `
SELECT 
    tweet, COUNT(*) AS likes,
    (
    SELECT 
        COUNT(*) AS replies
    FROM 
        tweet INNER JOIN reply ON
        tweet.tweet_id = reply.tweet_id
    WHERE 
        tweet.user_id = ${userId}
    GROUP BY
        tweet.tweet_id
        ) AS replies, tweet.date_time
FROM 
    tweet INNER JOIN like ON 
    tweet.tweet_id = like.tweet_id
WHERE tweet.user_id = ${userId}
GROUP BY 
      tweet.tweet_id;`;
  const tweetData = await db.all(getTweetQuery);
  response.send(tweetData.map((item) => tweetStats(item)));
});

//API 10 -> Create a new tweet
app.post("/user/tweets/", authenticateTokens, async (request, response) => {
  const { username } = request;
  const userId = await getUser(username);

  const { tweet } = request.body;
  const createTweetQuery = `
    INSERT INTO 
        tweet(tweet, user_id)
    VALUES ('${tweet}', ${userId});`;

  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//API 11 -> Delete a tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateTokens,
  async (request, response) => {
    const { username } = request;
    const userId = await getUser(username);

    const { tweetId } = request.params;
    const getTweetQuery = `
        SELECT * 
        FROM tweet
        WHERE 
            tweet_id = ${tweetId};`;
    const getTweet = await db.get(getTweetQuery);

    const { user_id } = getTweet;

    if (user_id === userId) {
      const deleteQuery = `
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId};`;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
