#!/usr/bin/env python3

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.layers.processing.h5ad_data_file import H5ADDataFile

# Set input information
input_file="my_data/test2.h5ad"
output_folder="my_data/test2.cxg"
sparse_threshold=10 # for 10%, percentage of non-zero values in the matrix above which the matrix will be considered dense and below which it will be considered sparse
dataset_version_id="dataset_version_id"

# Initialize with H5AD file
h5ad_file = H5ADDataFile(
    input_filename=input_file
)

# Convert to CXG format
h5ad_file.to_cxg(
    output_cxg_directory=output_folder,
    sparse_threshold=sparse_threshold,
    dataset_version_id=dataset_version_id
)