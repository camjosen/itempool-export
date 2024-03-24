# R.I.P. Itempool (2020 - 2024)

Itempool was a question banking system with special support for math and
live lectures. It launched in 2020 to support Grant Sanderson's "Lockdown Math"
series. Thousands of teachers and hundreds of thousands of students used
Itempool for one purpose or another.

## Export to Google Docs

If you were an Itempool user, your content has already been organized into a
zip file and emailed to you. To actually use your content, you probably want
to export it to Google Docs. Here's how:

### Get your raw content

1. Download your zip file (check your email).

### Run this web server

1. Install docker
2. Download this repo
3. Run...
4. Navigate to localhost...
5. Upload your zip file. Authorize the app to upload to

## How to generate zip files (requires AWS credentials)

First, download the content from S3. I considered not requiring this step,
since the script could read directly from S3, but that was slower for
development, and I didn't know how much all of that data transfer would cost.

```
aws s3 sync s3://itempool-db-exported/itempool-db-export database/paraquet
aws s3 sync s3://public.itempooluserdata.com images
```

Then, run a script.

```
ts-node createZipFiles.ts
```
