import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    //storing refresh token in user object and in next step will save this user in mongodb
    user.refreshToken = refreshToken;
    //whenever you call save query method of mongodb, it will run all the validation rukes mentioned for each field in user model
    //if we want save() not to validate the fields then put validateBeforeSave as false
    user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while generating access and refresh token"
    );
  }
};

//we are passing callback fn to async handler
const registerUser = asyncHandler(async (req, res) => {
  //get user details from FE
  //validation - not empty
  //check if user already exist : username , password
  //check for images, check for avatar(it is required field)
  //upload them to cloudinary, avatar
  //create user object beacuse mongo is a nosql db which takes object- create in db
  //remove password and refresh toekn field from response
  //check for user creation in db
  // if user created in db then return response

  const { fullname, email, username, password } = req.body;

  console.log("email is:", email);

  //validation check -- field should not be empty

  //begginer level code is to check each field is not empty with separate if else condition

  //advance level code file is not empty
  if (
    [fullname, email, username, password].some(
      (field) => field?.trim() === "" || field?.trim() === undefined
    ) //if eny feild is empty , it will return true
  ) {
    throw new ApiError(400, "All fields are required");
  }

  //we can add multiple validation as well , for example - email format, fullname should have only alphabets etc..

  //to check user already exits or not
  const existedUser = await User.findOne({
    //with User which can connect directly to db , we can check if username or email already exist in db
    $or: [{ username }, { email }], //to check multiple feilds in mongodb we can use this syntax $or
  });

  if (existedUser) {
    throw new ApiError(409, "User with email or username already exists"); //check status 409 meaning
  }

  console.log("pathhhh", req.files);
  const avatarLocalPath = req.files?.avatar[0]?.path;
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required here");
  }

  //step - upload images to cloudinary
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  //check one more whether avatar got uploaded to cloudinary beofre storing to db as it is a required feild
  if (!avatar) {
    throw new ApiError(400, "Avatar file is required");
  }

  //store data to db
  //through this User we are talking to mongodb
  const user = await User.create({
    fullname,
    avatar: avatar.url,
    coverImage: coverImage?.url || "", //as this field is not mandatory (we are not checking above unlike avatar whether coverImage got uploaded i.e if url is there then store empty string )
    email,
    password,
    username: username.toLowerCase(),
  });

  //to test whether user got created in db or not
  //findById() provided by mongodb search user by id
  //Whenever we add new entriy in mongodb then it creates _id feild automatically in db
  //findById will return all the data of user but we dont need password or refreshtoken
  //to remove those field from response of db mongodb provides a select() which takes string arugument where you have to which fields are not required.
  //select syntax is wierd but it is how it is
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while regestring the user");
  }

  //return the response to client

  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "user registered successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  //req body -> data
  //username or email based login
  //find the user
  //password check
  //access and refresh token
  //send cookie

  const { email, username, password } = req.body;

  console.log("user email :", email)

  if (!username && !email) {
    throw new ApiError(400, "username or email is required");
  }

  //here is the alternative of above code
//   if(!(username || email)){
//     throw new ApiError(400, "username or email is required");
//   }

  //this is a query to find username or email from mongodb
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  //user variable at line 129 does not have refresh token value , its value is empty
  //but at this point we have refreshtoken stored in db .
  //here we have to decide whether making another db call to fetch latest user details is good ?
  //or directly updating the user variable(of line 129) to have refresh token available in that user object
  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken" //these two fields are not required in the returned data
  );

  //to create cookie to store access token
  //by providing this object to cookie ,we are saying that cookie can be updated at server only
  //frontend can access the cookie but wont be able to modify it
  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options) //cookie takes(key, value) and set multiple cookie just keep adding .cookie
    .cookie("refreshToken", refreshToken, options) //as we added cookieParser() middlleware in app.js i.e we are able to set cookie here. And this cookie will available in res object(res.cookie). We can also get cookie in req object(req.cookie)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  //to logout user we need user id but we dont have user id in req object
  // we need to write one middleware(auth.middleware.js) which will add user id to req object

  //For logout
  //delete refresh token & cookie
  await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined,
            },
        },
        {
            new: true, //it will make sure return updated value which means in user data refreshToken will be undefined
        }
    );

    const options = {
        httpOnly: true,
        secure: true,
      };

      return res
      .status(200)
      .clearCookie("accessToken", options) // while clearing cookie , we need to pass option like setting cookie
      .clearCookie("refreshToken", options)
      .json(new ApiResponse(200, {}, "User logged out successfully"))

});

const refreshAccessToken = asyncHandler(async ()=> {
    const incomingRefreshToken = req.cookies?.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken) {
        throw new ApiError(401, "unauthorized request")
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
    
        const user = User.findById(decodedToken?._id)
    
        if(!user) {
            throw new ApiError(401, "invalid refresh token")
        }
    
        if(incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Refresh token is expired or used ")
        }
    
        const options = {
            httpOnly: true,
            secure: true
        }
    
        const { accessToken, newRefreshToken } = await generateAccessAndRefreshTokens(user._id)
    
        return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
            new ApiResponse(
                200,
                { accessToken, refreshToken: newRefreshToken },
                "Access token refreshed"
            )
        )
    } catch (error) {
        throw new ApiError(402, "Invalid refresh token")
    }
})

const changeCurrentPassword = asyncHandler(async (req, res) => {

    const { oldPassword, newPassword } = req.body

    const user = await User.findById(req.user?._id)

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect) {
        throw new ApiError(400, "Invalid old password")
    }

    user.newPassword = newPassword

    await User.save({ validateBeforeSave: false}) //before saving pre hook middleware will be called to hash the new password

    return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password updated successfully"))
})

const getCurrentUser = asyncHandler(async (req,res) => {
    return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current user fetched successfully"))
})

const updateAccountDetails = asyncHandler(async (req,res) => {

    const { fullname, email } = req.body

    if(!(fullname || email)) {
        throw new ApiError(400, "All fields are required")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullname,
                email
            },
        },
        {
            new: true // it will return the updated user details after the update
        }
    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async (req,res) => {

    const avatarLocalPath = req.file?.path // here we have are asking for only avatar image for profile picture i.e file.path not files.path unlike register user controller where we were asking for avatar and cover Image

    if(!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is missing")
    }

    //TODO: delete old image 

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url) {
        throw new ApiError(400, "Error while uploading avatar on cloudinary")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        {
            new: true // it will return the updated user details after the update
        }
    ).select("-password")

    return res
    .status(200)
    .json( new ApiResponse(200, user, "Avatar Image updated successfully"))

})

const updateUserCoverImage = asyncHandler(async (req,res) => {

    const coverImageLocalPath = req.file?.path // here we have are asking for only avatar image for profile picture i.e file.path not files.path unlike register user controller where we were asking for avatar and cover Image

    if(!coverImageLocalPath) {
        throw new ApiError(400, "Cover Image file is missing")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url) {
        throw new ApiError(400, "Error while uploading cover image on cloudinary")
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        {
            new: true // it will return the updated user details after the update
        }
    ).select("-password")

    return res
    .status(200)
    .json( new ApiResponse(200, user, "Cover Image updated successfully"))

})

const getUserChannelProfile = asyncHandler(async (req,res) => {

    const { username } = req.params;

    if(!username?.trim()) {
        throw new ApiError(400, "username is missing")
    }

    //aggregation pipeline - mongodb advance topic
    const channel = await User.aggregate([
        { //1st pipeline
            $match: {
                username: username?.toLowerCase()
            },
        },
        { //2nd pipeline
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        { //3rd pipeline
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        { //4th pipeline
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelsSubscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: {$in: [req.user?._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        { //5th pipeline
            $project : {
                fullname: 1,
                username: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1
            }
        }
    ])

    if(!channel?.length) {
        throw new ApiError(404, "channel does not exists")
    }

    console.log("channel: ", channel)

    return res
    .status(200)
    .json(
        new ApiResponse(200, channel[0], "User channel fetched successfully")
    )
})

const getWatchHistory = asyncHandler(async (req,res) => {
    const user = await User.aggregate([
        {
            $match : {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [ //nested lookup
                    {
                        $lookup: { //sub lookup
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullname: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ])

    console.log(user)

    return res
    .status(200)
    .json(
        new ApiResponse(200, user[0].watchHistory, "watched history fetched fetch successfully")
    )
})

export { registerUser,
        loginUser,
        logoutUser, 
        refreshAccessToken, 
        changeCurrentPassword, 
        getCurrentUser,
        updateAccountDetails,
        updateUserAvatar,
        updateUserCoverImage,
        getUserChannelProfile,
        getWatchHistory
     };
